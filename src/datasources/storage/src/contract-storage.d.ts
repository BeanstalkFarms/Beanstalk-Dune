interface StorageProvider {
  getStorageAt(contractAddress: any, storageSlot: any, blockNumber?: any): Promise<any>;
}

class ContractStorage {
  constructor(provider: StorageProvider, contractAddress: string, storageLayout: any, defaultBlock?: number | string);
  __setDefaultBlock(newDefault: number | string): void;
  
  [key: string]: any;
}

export = ContractStorage;