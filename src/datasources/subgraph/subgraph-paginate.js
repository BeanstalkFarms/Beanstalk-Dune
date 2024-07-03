/**
 * Paginates a given subgraph query according to Graph Protocol's GraphQL API spec.
 * Only a single entity type should be requested at a time.
 *
 * @param {function} subgraphClient
 * @param {string} query - the query to be paginated. Must NOT include any where clause here.
 * @param {string} block - (optional) block argument, of the form `block: {number: ${value}}`
 * @param {string} where - (optional) additional fields to search by, of the form `field: "${value}, ..."`
 * @param {string[]} paginateFields - the fields to paginate on
 * @param {string[]} firstValues - the initial values to begin with of the paginateFields
 * @param {'asc' | 'desc'} paginateDirection - the direction to paginate
 * @returns all results matching the query
 *
 * Note that graph protocol can only order by a single field, and therefore it is possible for
 * some results to be skipped in the case of paginating by multiple fields. For this reason, there is
 * some overlap added between the pages, which is filtered out using prevPageIds list.
 */
async function allPaginatedSG(subgraphClient, query, block, where, paginateFields, firstValues, paginateDirection) {
  const PAGE_SIZE = 1000;
  const whereSuffix = paginateDirection === 'asc' ? '_gte' : '_lte';

  let prevPageIds = [];

  const retval = [];
  while (firstValues[0] !== undefined) {
    // Construct arguments for pagination
    const whereClause = `{${paginateFields.map((v, idx) => `${v}${whereSuffix}: ${formatType(firstValues[idx])}`).join(', ')}, ${where}}`;
    const paginateArguments = `(${block} where: ${whereClause} first: ${PAGE_SIZE} orderBy: ${paginateFields[0]} orderDirection: ${paginateDirection})`;
    let entityName = '';
    // Add the generated arguments to the query
    const paginatedQuery = query.replace(/(\w+)\s{/, (match, p1) => {
      entityName = p1;
      return `${entityName} ${paginateArguments} {`;
    });
    const result = await subgraphClient(paginatedQuery);

    if (!result[entityName][0].id) {
      throw new Error("field `id` was not present on the returned entity");
    }

    // Record the results and repeat as necessary. Filter any repeated results on overlapping pages.
    const pageIds = [];
    for (const r of result[entityName]) {
      if (!prevPageIds.includes(r.id)) {
        pageIds.push(r.id);
        retval.push(r);
      }
    }
    prevPageIds = pageIds;
    firstValues = paginateFields.map((v) => result[entityName][PAGE_SIZE - 1]?.[v]);
  }
  return retval;
}

function formatType(value) {
  if (typeof value === 'number') {
    return value;
  } else {
    return `"${value}"`;
  }
}

module.exports = {
  allPaginatedSG
};
