const fs = require('fs');

const FILE_PATH = 'results/cursor';
// Returns the last block number that has been processed for this result file
function getLastProcessed(fileName) {

    const cursorFile = fs.readFileSync(FILE_PATH, 'utf-8');

    const pattern = new RegExp(`${fileName},(\\d+)`);
    const match = cursorFile.match(pattern);
    
    return parseInt(match?.[1] ?? -1);
}

// Updates the last block number that has been processed for this result file
async function setLastProcessed(fileName, blockNumber) {

    const cursorFile = fs.readFileSync(FILE_PATH, 'utf-8');

    const pattern = new RegExp(`${fileName},(\\d+)`);
    const updatedEntry = `${fileName},${blockNumber}`;
    const updatedFile = cursorFile.replace(pattern, updatedEntry);

    if (updatedFile !== cursorFile) {
        await fs.promises.writeFile(FILE_PATH, updatedFile);
    } else {
        // Replacement did not occur, therefore the fileName must not yet have a cursor entry
        await fs.promises.appendFile(FILE_PATH, updatedEntry + '\n');
    }
}

(async function initCursorFile() {
    if (!fs.existsSync(FILE_PATH)) {
        await fs.promises.appendFile(FILE_PATH, '');
    }
})();

module.exports = {
    getLastProcessed: getLastProcessed,
    setLastProcessed: setLastProcessed
};
