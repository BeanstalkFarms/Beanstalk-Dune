# EVM Contract Storage Tool

A lightweight tool for quickly retrieving arbitrary storage variables. View functions are no longer necessary to read every field.

✅ fields
✅ structs
✅ mappings
✅ arrays
✅ dynamic arrays

## Sample Mapping 

In Solidity, you might write something like:

```
uint256 stalk = s.s.stalk;
uint256 userPlotAmount = s.a[account].plots[index].amount
```

To achieve this in JavaScript, now we can write:

```
const beanstalk = new ContractStorage(provider, contractAddress, storageLayout);
const stalk = await beanstalk.s.s.stalk;
const userPlotAmount = await beanstalk.s.a[account].plots[index].amount;
```

## ContractStorage object

`constructor(provider, contractAddress, storageLayout, defaultBlock = 'latest')`
- `provider`: an ethersjs provider, or anything having a `getStorageAt(address, slot)` function.
- `contractAddress`: the address of the contract that you desire to retrieve storage for.
- `storageLayout`: the storage layout mapping for your contract.
- `blockNumber` (optional): the default block number to use for storage lookup. Uses the latest block if not provided.

---

`__setDefaultBlock(block)`
- Changes the default block to be `block`.

## Where to get the storageLayout mapping

After compiling the Solidity contract you want to analyze, included among the compilation artifacts is a JSON file containing a `storageLayout` property. The location of this file may vary depending on which compiler you are using. Once you have located the output file, find the `storageLayout` property for the desired contract. Copy the value into a JSON file. This file will be read into the program and supplied to the ContractStorage constructor. Some sample `storageLayout` mappings (for Beanstalk) can be found in this repository, but are not included in the published package.

## Other features

If you want to read a different block, rather than changing the default block, the below syntax is also supported. This is extremely useful if you want to retrieve multiple slots at once using `Promise.all()`, where changing the default block could lead to a race condition.

```
const stalkAtBlock19m = await beanstalk[19000000].s.s.stalk;
const stalkAtBlock20m = await beanstalk[20000000].s.s.stalk;
```


If trying to read an entire array, rather than enumerating by length, we can write the below. This is significantly more performant than enumeration if the underlying data type can fit multiple entries in the same slot.

```
const allCases = await beanstalk.s.cases;
```

If you just want the slot number associated with a field, and not to retrieve its contents, you can instead write:
```
const userPlotSlot = beanstalk.s.a[account].plots[index].amount.slot;
// Compared to
const userPlotAmount = await beanstalk.s.a[account].plots[index].amount;
```

## Future Work

For Diamond/Proxy contracts, the option to provide multiple `storageLayout` files corresponding to different block ranges would allow for more seamless analysis of contracts in the midst of protocol upgrades. Currently, a separate `ContractStorage` object would need to be constructed and this orchestration managed externally.
