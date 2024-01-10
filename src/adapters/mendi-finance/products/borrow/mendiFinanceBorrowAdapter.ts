import { SimplePoolAdapter } from '../../../../core/adapters/SimplePoolAdapter'
import { Chain } from '../../../../core/constants/chains'
import { ZERO_ADDRESS } from '../../../../core/constants/ZERO_ADDRESS'
import { aprToApy } from '../../../../core/utils/aprToApy'
import { SECONDS_PER_YEAR } from '../../../../core/constants/SECONDS_PER_YEAR'
//import { RAY } from '../../../../core/constants/RAY'
import {
  IMetadataBuilder,
  CacheToFile,
} from '../../../../core/decorators/cacheToFile'
import { NotImplementedError } from '../../../../core/errors/errors'
import { getTokenMetadata } from '../../../../core/utils/getTokenMetadata'
import { logger } from '../../../../core/utils/logger'
import {
  ProtocolDetails,
  PositionType,
  GetAprInput,
  GetApyInput,
  GetTotalValueLockedInput,
  TokenBalance,
  ProtocolTokenApr,
  ProtocolTokenApy,
  ProtocolTokenTvl,
  UnderlyingTokenRate,
  Underlying,
  TokenType,
} from '../../../../types/adapter'
import { Erc20Metadata } from '../../../../types/erc20Metadata'
import {
  Converter__factory,
  Velocore__factory,
  Oracle__factory,
  Speed__factory,
  Cerc20__factory,
  Comptroller__factory,
} from '../../contracts'

type MendiFinanceBorrowAdapterMetadata = Record<
  string,

  {
    protocolToken: Erc20Metadata
    underlyingToken: Erc20Metadata
  }

>

export class MendiFinanceBorrowAdapter
  extends SimplePoolAdapter
  implements IMetadataBuilder
{
  productId = 'borrow'

  /**
   * Update me.
   * Add your protocol details
   */
  getProtocolDetails(): ProtocolDetails {
    return {
      protocolId: this.protocolId,
      name: 'MendiFinance',
      description: 'MendiFinance borrow adapter',
      siteUrl: 'https://mendi.finance/:',
      iconUrl: 'https://mendi.finance/mendi-token.svg',
      positionType: PositionType.Borrow,
      chainId: this.chainId,
      productId: this.productId,
    }
  }

  /**
   * Update me.
   * Add logic to build protocol token metadata
   * For context see dashboard example ./dashboard.png
   * We need protocol token names, decimals, and also linked underlying tokens
   */
  @CacheToFile({ fileKey: 'mendi' })
  async buildMetadata() {
    const contractAddresses: Partial<Record<Chain, string>> = {
      [Chain.Linea]: '0x1b4d3b0421dDc1eB216D230Bc01527422Fb93103',
    }

    const comptrollerContract = Comptroller__factory.connect(
      contractAddresses[this.chainId]!,
      this.provider,
    )

    const pools = await comptrollerContract.getAllMarkets()

    const metadataObject: MendiFinanceBorrowAdapterMetadata = {}

    await Promise.all(
      pools.map(async (poolContractAddress) => {
        const poolContract = Cerc20__factory.connect(
          poolContractAddress,
          this.provider,
        )

        let underlyingContractAddress: string
        try {
          underlyingContractAddress = await poolContract.underlying()
        } catch (error) {
          underlyingContractAddress = ZERO_ADDRESS
        }

        const protocolTokenPromise = getTokenMetadata(
          poolContractAddress,
          this.chainId,
          this.provider,
        )
        const underlyingTokenPromise = getTokenMetadata(
          underlyingContractAddress,
          this.chainId,
          this.provider,
        )

        const [protocolToken, underlyingToken] = await Promise.all([
          protocolTokenPromise,
          underlyingTokenPromise,
        ])

        metadataObject[poolContractAddress.toLowerCase()] = {
          protocolToken,
          underlyingToken,
        }
      }),
    )
    return metadataObject
  }

  /**
   * Update me.
   * Below implementation might fit your metadata if not update it.
   */
  async getProtocolTokens(): Promise<Erc20Metadata[]> {
    return Object.values(await this.buildMetadata()).map(
      ({ protocolToken }) => protocolToken,
    )
  }

  protected async getUnderlyingTokenBalances({
    userAddress,
    protocolTokenBalance,
    blockNumber,
  }: {
    userAddress: string
    protocolTokenBalance: TokenBalance
    blockNumber?: number
  }): Promise<Underlying[]> {
    const { underlyingToken } = await this.fetchPoolMetadata(
      protocolTokenBalance.address,
    )

    const poolContract = Cerc20__factory.connect(
      protocolTokenBalance.address,
      this.provider,
    )

    const underlyingBalance = await poolContract.balanceOfUnderlying.staticCall(
      userAddress,
      {
        blockTag: blockNumber,
      },
    )

    const underlyingTokenBalance = {
      ...underlyingToken,
      balanceRaw: underlyingBalance,
      type: TokenType.Underlying,
    }

    return [underlyingTokenBalance]
  }

  /**
   * Update me.
   * Add logic to find tvl in a pool
   *
   */
  async getTotalValueLocked(
    _input: GetTotalValueLockedInput,
  ): Promise<ProtocolTokenTvl[]> {
    throw new NotImplementedError()
  }

  /**
   * Update me.
   * Below implementation might fit your metadata if not update it.
   */
  protected async fetchProtocolTokenMetadata(
    protocolTokenAddress: string,
  ): Promise<Erc20Metadata> {
    const { protocolToken } = await this.fetchPoolMetadata(protocolTokenAddress)

    return protocolToken
  }

  /**
   * Update me.
   * Add logic that finds the underlying token rates for 1 protocol token
   */
  /*protected async getUnderlyingTokenConversionRate(
    _protocolTokenMetadata: Erc20Metadata,
    _blockNumber?: number | undefined,
  ): Promise<UnderlyingTokenRate[]> {
    throw new NotImplementedError()
  }*/

  protected async getUnderlyingTokenConversionRate(
    protocolTokenMetadata: Erc20Metadata,
    blockNumber?: number | undefined,
  ): Promise<UnderlyingTokenRate[]> {
    const { underlyingToken } = await this.fetchPoolMetadata(
      protocolTokenMetadata.address,
    )

    const poolContract = Cerc20__factory.connect(
      protocolTokenMetadata.address,
      this.provider,
    )

    const exchangeRateCurrent =
      await poolContract.exchangeRateCurrent.staticCall({
        blockTag: blockNumber,
      })

    // The current exchange rate is scaled by 1 * 10^(18 - 8 + Underlying Token Decimals).
    const adjustedExchangeRate = exchangeRateCurrent / 10n ** 10n

    return [
      {
        ...underlyingToken,
        type: TokenType.Underlying,
        underlyingRateRaw: adjustedExchangeRate,
      },
    ]
  }

  /*async getApr(_input: GetAprInput): Promise<ProtocolTokenApr> {
    throw new NotImplementedError()
  }

  async getApy(_input: GetApyInput): Promise<ProtocolTokenApy> {
    throw new NotImplementedError()
  }*/

  async getApy({
    protocolTokenAddress,
    blockNumber,
  }: GetApyInput): Promise<ProtocolTokenApy> {
    const apy = await this.getProtocolTokenApy({
      protocolTokenAddress,
      blockNumber,
    })

    return {
      ...(await this.fetchProtocolTokenMetadata(protocolTokenAddress)),
      apyDecimal: apy * 100,
    }
  }

  async getApr({
    protocolTokenAddress,
    blockNumber,
  }: GetAprInput): Promise<ProtocolTokenApr> {
    const apr = await this.getProtocolTokenApr({
      protocolTokenAddress,
      blockNumber,
    })

    return {
      ...(await this.fetchProtocolTokenMetadata(protocolTokenAddress)),
      aprDecimal: apr * 100,
    }
  }

  /**
   * Update me.
   * Below implementation might fit your metadata if not update it.
   */
  protected async fetchUnderlyingTokensMetadata(
    protocolTokenAddress: string,
  ): Promise<Erc20Metadata[]> {
    const { underlyingToken } = await this.fetchPoolMetadata(
      protocolTokenAddress,
    )

    return [underlyingToken]
  }

  /**
   * Update me.
   * Below implementation might fit your metadata if not update it.
   */
  private async fetchPoolMetadata(protocolTokenAddress: string) {
    const poolMetadata = (await this.buildMetadata())[protocolTokenAddress]

    if (!poolMetadata) {
      logger.error({ protocolTokenAddress }, 'Protocol token pool not found')
      throw new Error('Protocol token pool not found')
    }

    return poolMetadata
  }

  private async getProtocolTokenApy({
    protocolTokenAddress,
    blockNumber,
  }: GetApyInput): Promise<number> {
    const poolContract = Cerc20__factory.connect(
      protocolTokenAddress,
      this.provider,
    )
    const underlyingTokenMetadata = (
      await this.fetchPoolMetadata(protocolTokenAddress)
    ).underlyingToken

    const srpb = await poolContract.borrowRatePerBlock.staticCall()
    const apr = (Number(srpb) * Number(SECONDS_PER_YEAR)) / Number(1e18)
    const apy = aprToApy(apr, SECONDS_PER_YEAR)

    return apy
  }

  private async getProtocolTokenApr({
    protocolTokenAddress,
    blockNumber,
  }: GetAprInput): Promise<number> {
    const poolContract = Cerc20__factory.connect(
      protocolTokenAddress,
      this.provider,
    )
    const underlyingTokenMetadata = (
      await this.fetchPoolMetadata(protocolTokenAddress)
    ).underlyingToken

    const speedContract = Speed__factory.connect(
      '0x3b9B9364Bf69761d308145371c38D9b558013d40',
      this.provider,
    )

    const oracleContract = Oracle__factory.connect(
      '0xCcBea2d7e074744ab46e28a043F85038bCcfFec2',
      this.provider,
    )

    const velocoreContract = Velocore__factory.connect(
      '0xaA18cDb16a4DD88a59f4c2f45b5c91d009549e06',
      this.provider,
    )

    const converterContract = Converter__factory.connect(
      '0xAADAa473C1bDF7317ec07c915680Af29DeBfdCb5',
      this.provider,
    )

    const mendiAddress = '0x43E8809ea748EFf3204ee01F08872F063e44065f'
    const convertValue = await converterContract.latestAnswer.staticCall()
    const convertDiv = Number(convertValue) / 1e8

    const baseTokenBytes32 =
      '0x' +
      '0x176211869ca2b568f2a7d4ee941e073a821ee1ff'
        .toLowerCase()
        .replace(/^0x/, '')
        .padStart(64, '0')

    const quoteTokenBytes32 =
      '0x' + mendiAddress.toLowerCase().replace(/^0x/, '').padStart(64, '0')

    const amount = '1000000000000000000'
    const mPrice = await velocoreContract.spotPrice.staticCall(
      quoteTokenBytes32,
      baseTokenBytes32,
      amount.toString(),
    )
    const mPriceFixed = (
      (Number(mPrice) / Number(1e6)) *
      Number(convertDiv)
    ).toFixed(3)

    const supplySpeed = await speedContract.rewardMarketState.staticCall(
      mendiAddress,
      protocolTokenAddress,
    )

    const tokenBorrows = await poolContract.totalBorrows.staticCall()
    const exchangeRateStored =
      await poolContract.exchangeRateStored.staticCall()
    const underlingPrice = await oracleContract.getPrice.staticCall(
      protocolTokenAddress,
    )

    const tokenDecimal = underlyingTokenMetadata.decimals

    const marketTotalBorrows =
      (Number(tokenBorrows) / Math.pow(10, tokenDecimal)) *
      Number(underlingPrice)
    const apr =
      (Number(supplySpeed.borrowSpeed) *
        Number(mPriceFixed) *
        Number(SECONDS_PER_YEAR)) /
      Number(marketTotalBorrows)

    return apr
  }
}