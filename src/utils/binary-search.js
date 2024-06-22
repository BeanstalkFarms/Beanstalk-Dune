// General binary search wrapper for integer low/high
async function binarySearch(low, high, searchFn, loopCallback) {

  let middle;
  const iterate = () => middle = Math.floor((low + high) / 2);
  iterate();
  
  while (middle < high && middle > low) {
    const searchResult = await searchFn(middle, low, high);
    loopCallback?.(middle, searchResult);
    if (searchResult == 1) {
      low = middle;
    } else if (searchResult == -1) {
      high = middle;
    } else {
      return {
        exact: true,
        location: middle
      };
    }
    iterate();
  }
  return {
    exact: false,
    location: middle
  };
}

// Finds all inputs for which the value outputted by valueFn changes
// Assumption is that when a value changes, it does not change back into the same value again later,
// Otherwise results can be inaccurate!
async function findAllValueChanges(start, end, valueFn, loopCallback, valueFoundCallback) {
  const allChanges = {
    [start]: await valueFn(start)
  };

  while (start < end) {
    const startValue = allChanges[start];
    const result = await binarySearch(
      start,
      end,
      async (middle, low, high) => {
        const current = await valueFn(middle);
        if (current !== startValue) {
          return -1;
        } else if (high - low <= 2) {
          // End occurs when these 2 values are next to each other.
          // This can also occur even if the value didnt change (i.e. at the end).
          return 0;
        } else {
          return 1;
        }
      }, 
      loopCallback
    );

    const [v1, v2] = await Promise.all([
      valueFn(result.location),
      valueFn(result.location + 1)
    ]);
    if (startValue !== v1) {
      // Im not sure if this case can actually trigger
      allChanges[result.location] = v1;
      start = result.location;
      console.log('v1');
    } else {
      // startValue can equal v2 when this is the end
      allChanges[result.location + 1] = v2;
      start = result.location + 1;
      console.log('v2');
    }

    valueFoundCallback?.(start, end, result);
  }
  return allChanges;
}

module.exports = {
  binarySearch,
  findAllValueChanges
};
