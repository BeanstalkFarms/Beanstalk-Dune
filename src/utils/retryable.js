const timeoutPromise = (timeLimitMs) => new Promise((resolve, reject) => 
        setTimeout(() => reject(new Error('Promise exceeded time limit')), timeLimitMs)
);
function retryable(asyncFunction, timeLimitMs = 10000, retryCount = 2) {
    if (retryCount < 0) {
        return Promise.reject(new Error('Exceeded retry count'));
    }
    return new Promise((resolve, reject) => {
        Promise.race([asyncFunction(), timeoutPromise(timeLimitMs)])
                // asyncFunction was successful
                .then(resolve)
                // asyncFunction failed or timed out, retry
                .catch((e) => {
                    console.log('[retryable] Error encountered, retrying: ', retryCount - 1, e);
                    retryable(asyncFunction, timeLimitMs, retryCount - 1).then(resolve).catch(reject);
                });
    });
}

module.exports = retryable;
