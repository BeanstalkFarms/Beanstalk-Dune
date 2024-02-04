const { uploadCsv } = require('./dune-export.js');
const { buildFertilizer } = require('./tables/fertilizer.js');
const { buildUnripe } = require('./tables/unripe.js');

(async () => {
    await buildFertilizer().then(uploadCsv);
    await buildUnripe().then(uploadCsv);
})();

// TODO:
// Some class structure abstracting boilerplate for the various tables (i.e. fertilizer/unripe.js)
// Proof of concept using subgraph
// Have some recognition of block number -> which ABI to use, or when to stop, and handling when functions dont exist
// Support for adjusting columns/reiterating and adding to existing datasets rather than having to recreate everything