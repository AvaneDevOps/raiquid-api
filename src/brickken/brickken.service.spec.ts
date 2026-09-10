import { NotImplementedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Brickken } from 'brickken-sdk';
import { AuthError, RateLimitError, ValidationError } from 'brickken-sdk';
import { BrickkenService } from './brickken.service';
import { BrickkenIntegrationError } from './brickken.errors';
import type { PrismaService } from '../prisma/prisma.service';
import { OnChainStatus } from '../common/enums';

type EventRow = { id: string; status: string; txHash: string | null };

function makeService(bkn: Partial<Brickken>) {
  const events: EventRow[] = [];
  const create = jest.fn(({ data }: { data: Record<string, unknown> }) => {
    const row: EventRow = {
      id: `evt-${events.length + 1}`,
      status: data.status as string,
      txHash: null,
    };
    events.push(row);
    return Promise.resolve(row);
  });
  const update = jest.fn(
    ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => {
      const row = events.find((e) => e.id === where.id)!;
      if (typeof data.status === 'string') row.status = data.status;
      if ('txHash' in data) row.txHash = (data.txHash as string) ?? null;
      return Promise.resolve(row);
    },
  );
  const prisma = {
    onChainEvent: { create, update },
  } as unknown as PrismaService;

  const config = {
    get: (key: string) =>
      ({
        BRICKKEN_CHAIN_ID: '84532',
        BRICKKEN_TOKENIZER_EMAIL: 'tokenizer@raiquid.test',
        BRICKKEN_ACCEPTED_COIN: '0x0000000000000000000000000000000000000000',
      })[key],
  } as unknown as ConfigService;

  return {
    service: new BrickkenService(bkn as Brickken, prisma, config),
    create,
    events,
  };
}

describe('BrickkenService', () => {
  it('writes a pending OnChainEvent, then confirms it with the tx hash on success', async () => {
    const sdkCreate = jest.fn().mockResolvedValue({
      txId: 'tx-1',
      executionMode: 'client-signed',
      transactions: [],
      raw: {},
      sent: { transactionHashes: ['0xdeadbeef'] },
    });
    const { service, create, events } = makeService({
      tokenization: {
        create: sdkCreate,
      } as unknown as Brickken['tokenization'],
    });

    const result = await service.tokenizeInvoice({
      invoiceId: 'inv-1',
      tokenSymbol: 'RABCD',
      name: 'Invoice INV-1',
      supplyCap: '100000',
    });

    expect(result.txHash).toBe('0xdeadbeef');
    expect(sdkCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenSymbol: 'RABCD',
        tokenType: 'BILL_FACTORING',
        chainId: '84532',
        tokenizerEmail: 'tokenizer@raiquid.test',
        supplyCap: '100000',
      }),
      { execute: true },
    );
    expect(create.mock.calls[0][0].data).toEqual(
      expect.objectContaining({
        action: 'newTokenization',
        status: OnChainStatus.pending,
        invoiceId: 'inv-1',
        chainId: 84532,
      }),
    );
    expect(events).toEqual([
      { id: 'evt-1', status: OnChainStatus.confirmed, txHash: '0xdeadbeef' },
    ]);
  });

  it('marks the OnChainEvent failed and throws a mapped BrickkenIntegrationError', async () => {
    const sdkCreate = jest.fn().mockRejectedValue(new AuthError('bad key'));
    const { service, events } = makeService({
      tokenization: {
        create: sdkCreate,
      } as unknown as Brickken['tokenization'],
    });

    await expect(
      service.tokenizeInvoice({
        invoiceId: 'inv-2',
        tokenSymbol: 'RWXYZ',
        name: 'x',
        supplyCap: '1',
      }),
    ).rejects.toMatchObject({ name: 'BrickkenIntegrationError', kind: 'auth' });
    expect(events[0].status).toBe(OnChainStatus.failed);
  });

  it('maps documented SDK error classes to a kind', async () => {
    const cases: Array<[Error, string]> = [
      [new ValidationError('nope'), 'validation'],
      [new AuthError('nope'), 'auth'],
      [new RateLimitError(30), 'rate_limited'],
    ];
    for (const [err, kind] of cases) {
      const sdkCreate = jest.fn().mockRejectedValue(err);
      const { service } = makeService({
        tokenization: {
          create: sdkCreate,
        } as unknown as Brickken['tokenization'],
      });
      await expect(
        service.tokenizeInvoice({
          invoiceId: 'inv',
          tokenSymbol: 'RAAAA',
          name: 'x',
          supplyCap: '1',
        }),
      ).rejects.toHaveProperty('kind', kind);
    }
  });

  it('launchOffering: no STO id in the response is a failure', async () => {
    const sdkCreate = jest.fn().mockResolvedValue({
      txId: 'tx',
      executionMode: 'client-signed',
      transactions: [],
      raw: { data: {} },
      info: {},
      sent: { transactionHashes: ['0xabc'] },
    });
    const { service } = makeService({
      sto: { create: sdkCreate } as unknown as Brickken['sto'],
    });

    await expect(
      service.launchOffering({
        invoiceId: 'inv',
        tokenSymbol: 'RAAAA',
        offeringName: 'x',
        tokenAmount: '1',
        raiseAmount: '1',
        startDate: new Date(),
        endDate: new Date(),
      }),
    ).rejects.toBeInstanceOf(BrickkenIntegrationError);
  });

  it('launchOffering: returns the STO id and passes Unix-seconds dates', async () => {
    const sdkCreate = jest.fn().mockResolvedValue({
      txId: 'tx',
      executionMode: 'client-signed',
      transactions: [],
      raw: {},
      info: { stoId: 'sto-123' },
      sent: { transactionHashes: ['0xabc'] },
    });
    const { service } = makeService({
      sto: { create: sdkCreate } as unknown as Brickken['sto'],
    });

    const out = await service.launchOffering({
      invoiceId: 'inv',
      tokenSymbol: 'RAAAA',
      offeringName: 'x',
      tokenAmount: '1',
      raiseAmount: '1',
      startDate: new Date('2027-01-01T00:00:00Z'),
      endDate: new Date('2027-01-04T00:00:00Z'),
    });

    expect(out.stoId).toBe('sto-123');
    expect(sdkCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        startDate: String(Date.parse('2027-01-01T00:00:00Z') / 1000),
        endDate: String(Date.parse('2027-01-04T00:00:00Z') / 1000),
      }),
      { execute: true },
    );
  });

  it('whitelistInvestorWallet is an explicit stub', () => {
    const { service } = makeService({});
    expect(() => service.whitelistInvestorWallet()).toThrow(
      NotImplementedException,
    );
  });
});
