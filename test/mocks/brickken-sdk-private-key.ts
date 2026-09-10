export function fromPrivateKey(_privateKey: string) {
  return {
    address: () =>
      Promise.resolve('0x0000000000000000000000000000000000000001'),
    signTypedData: () => Promise.resolve('0x00'),
    signTransaction: () => Promise.resolve('0x00'),
  };
}
