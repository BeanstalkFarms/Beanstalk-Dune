const { GraphQLClient, gql } = require('graphql-request');

const SUBGRAPH_BEANSTALK = 'https://graph.node.bean.money/subgraphs/name/beanstalk';
const SUBGRAPH_BEAN = 'https://graph.node.bean.money/subgraphs/name/bean';

const clients = {};

function getClient(url) {
    if (!clients[url]) {
        clients[url] = new GraphQLClient(url);
    }
    return clients[url];
}

function subgraphBuilder(url) {
    return async (query) => {
        const client = getClient(url);
        return await client.request(query);
    }
}

module.exports = {
    beanstalkSG: subgraphBuilder(SUBGRAPH_BEANSTALK),
    beanSG: subgraphBuilder(SUBGRAPH_BEAN),
    builder: subgraphBuilder,
    gql: gql
}
