import { createXXHash32, createXXHash64, type IHasher } from "hash-wasm";

export interface XXHashAPI {
    h32(input: string, seed?: number): number;
    h32Raw(input: Uint8Array, seed?: number): number;
    h64(input: string, seed?: bigint): bigint;
}

const uint32FromHex = (hex: string) => Number.parseInt(hex, 16) >>> 0;
const bigintFromHex = (hex: string) => BigInt(`0x${hex}`);

export async function xxhashNew(): Promise<XXHashAPI> {
    const h32Hasher = await createXXHash32();
    const h64Hasher = await createXXHash64();

    return new HashWasmXXHashAPI(h32Hasher, h64Hasher);
}

class HashWasmXXHashAPI implements XXHashAPI {
    constructor(
        private readonly h32Hasher: IHasher,
        private readonly h64Hasher: IHasher
    ) {}

    h32(input: string, seed = 0): number {
        return this.hash32(input, seed);
    }

    h32Raw(input: Uint8Array, seed = 0): number {
        return this.hash32(input, seed);
    }

    h64(input: string, seed = 0n): bigint {
        this.assertDefaultSeed(seed);
        const hex = this.h64Hasher.init().update(input).digest();
        return bigintFromHex(hex);
    }

    private hash32(input: string | Uint8Array, seed: number): number {
        this.assertDefaultSeed(seed);
        const hex = this.h32Hasher.init().update(input).digest();
        return uint32FromHex(hex);
    }

    private assertDefaultSeed(seed: number | bigint): void {
        if (seed !== 0 && seed !== 0n) {
            throw new Error("Seeded xxhash calls are not supported by the hash-wasm adapter");
        }
    }
}
