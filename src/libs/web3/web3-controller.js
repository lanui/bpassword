import { debounce } from 'lodash';
import axios from 'axios';
import EventEmitter from 'events';
import ObservableStore from 'obs-store';
import ComposedStore from 'obs-store/lib/composed';
import moment from 'moment';

import { SmartAddressesTranslate } from './contracts/index';

import logger from '../logger';
import BizError from '../biz-error';
import {
  PROVIDER_ILLEGAL,
  NETWORK_UNAVAILABLE,
  ACCOUNT_NOT_EXISTS,
  INTERNAL_ERROR,
  INSUFFICIENT_BTS_BALANCE,
  WALLET_LOCKED,
  MEMBERSHIP_EXPIRED,
} from '../biz-error/error-codes';

import { getWeb3Inst, getChainConfig, compareWei, validGasFeeEnought } from './web3-helpers';
import APIManager from './apis';
import { getMemberBaseInFo } from './apis/bpt-member-api';

import {
  BT_TOKEN,
  ETH_TOKEN,
  BT_APPRPOVE_ESGAS,
  BPT_MEMBER_RECHARGE_ESGAS,
  BPT_STORAGE_WEB_COMMIT_ESGAS,
  BPT_STORAGE_MOB_COMMIT_ESGAS,
  BPT_MEMBER,
} from './contracts/enums';
import {
  MEMBER_COSTWEI_PER_YEAR,
  DEFAULT_GAS_LIMIT,
  TX_PENDING,
  TX_FAILED,
  TX_CONFIRMED,
  DEFAULT_GAS_STATION_URL,
  DEFAULT_GAS_PRICE,
  GAS_LIMIT_PLUS_RATE,
} from './cnst';

import { getBTContractInst } from './apis/bt-api';
import { getBptMemberAddress, getBPTMemberContractInst } from './apis/bpt-member-api';
import { signedRawTxData4Method } from './send-rawtx';
import Web3 from 'web3';

import { getWebStorageEventInst } from './apis/web-storage-event-api';
import { getMobStorageEventInst } from './apis/mob-storage-event-api';

/*********************************************************************
 * AircraftClass ::
 *    @description: update store struct
 *    @description:
 * WARNINGS:
 *
 * HISTORY:
 *    @author: lanbery@gmail.com
 *    @created:  2020-12-09
 *    @comments:
 **********************************************************************/

class Web3Controller extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.getCurrentProvider = opts.getCurrentProvider;

    this.getCurrentWalletState = opts.getCurrentWalletState;
    const initState = opts.initState || {};
    const {
      config = _initConfigState(),
      smarts = SmartAddressesTranslate(),
      balances = {},
      historys = {},
      txs = {},
      status = {},
      allowance = {},
      estimateState = {},
    } = initState;

    // config not depend chainId
    this.configStore = new ObservableStore(config);
    this.smartStore = new ObservableStore(smarts);
    this.balanceStore = new ObservableStore(balances);
    this.txStore = new ObservableStore(txs);
    this.historyStore = new ObservableStore(historys);
    this.statusStore = new ObservableStore(status);
    this.allowStore = new ObservableStore(allowance);
    this.estimateStore = new ObservableStore(estimateState);

    this.store = new ComposedStore({
      config: this.configStore,
      smarts: this.smartStore,
      balances: this.balanceStore,
      historys: this.historyStore,
      txs: this.txStore,
      status: this.statusStore,
      allowance: this.allowStore,
      estimateState: this.estimateStore,
    });

    this.on('reloadBalances', this.reloadBalances.bind(this));

    this.on('web3:reload:config', debounce(_reloadConfig.bind(this), 100));
    this.on('web3:reload:member:status', debounce(_reloadChainStatus.bind(this), 100));

    this.on('web3:reload:gasStation', _gasStation.bind(this));
    this.on(
      'update:status:store:estimateGas',
      debounce(this.updateEstimateGasConfig.bind(this), 1000)
    );
  }

  async reloadBalances() {
    const _provider = await this.getCurrentProvider();
    if (!_provider || !_provider.rpcUrl) {
      logger.warn('Current Provdier Unset or RPCUrl illegal.', _provider?.rpcUrl);
      throw new BizError('Provider Unset or illegal rpcUrl.', PROVIDER_ILLEGAL);
    }

    return _reloadBalances.call(this, _provider);
  }

  async getBalanceState() {
    const { chainId } = await this.getCurrentProvider();
    const { balances = {} } = this.store.getState();

    if (!chainId) {
      throw new BizError('provider chainId unfound', PROVIDER_ILLEGAL);
    }

    if (!balances || !balances[chainId]) {
      return {
        [ETH_TOKEN]: '0',
        [BT_TOKEN]: '0',
      };
    }
    return balances[chainId];
  }

  getChainEstimate(chainId) {
    if (!chainId && !!this.getCurrentProvider()) {
      provider = this.getCurrentProvider() || {};
      chainId = provider.chainId;
    }

    const wholeState = this.estimateStore.getState() || {};

    return wholeState[chainId] || {};
  }

  updateGasEstimate(key, gasNumber) {
    let { chainId } = this.getCurrentProvider();
    if (!chainId) {
      throw new BizError('lost chainId', INTERNAL_ERROR);
    }

    const wholeState = this.estimateStore.getState() || {};
    const old = wholeState[chainId] || {};
    let upState = {
      [chainId]: {
        ...old,
        [key]: gasNumber,
      },
    };

    this.estimateStore.updateState(upState);
    return upState;
  }

  getSendState(chainId) {
    const { balances = {}, txs = {}, config = {}, status = {} } = this.store.getState();
    if (!chainId) {
      chainId = config.chainId;
    }
    let chainBalances = {},
      chainStatus = {},
      chainEstimateState = {},
      chainTxs = [];
    if (chainId && typeof balances[chainId] === 'object') {
      chainBalances = balances[chainId];
    }
    if (chainId && txs && typeof txs === 'object' && Object.values(txs).length > 0) {
      chainTxs = Object.values(txs).filter((tx) => tx.chainId === chainId);
    }

    if (chainId && status[chainId]) {
      chainStatus = status[chainId];
    }

    chainEstimateState = this.getChainEstimate(chainId);

    chainStatus = {
      ...chainStatus,
      ...chainEstimateState,
    };

    const configState = this.configStore.getState();
    let gasState = _translateGasStation(configState, chainId);

    let chainAllowance = this.getChainAllowance(chainId);

    let sendState = {
      gasState,
      chainStatus,
      chainId,
      chainBalances,
      chainTxs,
      chainAllowance,
    };

    return sendState;
  }

  getChainTxs(chainId) {
    const txs = this.txStore.getState();
    let chainTxs = [];
    if (chainId && txs && typeof txs === 'object' && Object.values(txs).length > 0) {
      chainTxs = Object.values(txs).filter((tx) => tx.chainId === chainId);
    }

    return chainTxs;
  }

  /**
   * add txState into txStore
   * @param {string} chainId chainId
   * @param {*} txState
   * @param {string} statusText
   */
  addTxState(chainId, txState, statusText) {
    if (typeof txState !== 'object' || !txState.reqId || !chainId) {
      throw new BizError('Tx Object data illegal, or unfound chainId,reqId. ', INTERNAL_ERROR);
    }
    statusText = statusText || TX_PENDING;
    const uid = `${chainId}_${txState.reqId}`;
    const updateTxState = {
      [uid]: {
        ...txState,
        chainId,
        statusText,
      },
    };

    this.txStore.updateState(updateTxState);
  }

  /**
   *
   * @param {string} uid [chainId_reqId]
   * @param {string} statusText
   * @param {object} info
   */
  updateTxStatus(uid, statusText, info = {}) {
    const state = this.txStore.getState() || {};
    const old = state[uid];
    if (old) {
      let newState = {
        ...old,
        statusText,
        ...info,
      };

      this.txStore.updateState({ [uid]: newState });
    }
  }

  /**
   * methods key->number
   * @param {object} gasUsedState
   */
  updateEstimateGasConfig(gasUsedState, chainId) {
    if (!chainId) {
      chainId = this.configStore.getState().chainId;
    }
    if (typeof gasUsedState === 'object') {
      const wholeState = this.estimateStore.getState();
      const old = wholeState[chainId] || {};
      const updateState = {
        [chainId]: {
          ...old,
          ...gasUsedState,
        },
      };

      this.estimateStore.updateState(updateState);
    }
  }

  /**
   *
   * @param {object} allowanceState [BPT_MEMBER:value]
   *    key-value : 'bptMember' : allowance
   * @param {number} chainId
   */
  setAllowanceState(allowanceState, chainId) {
    if (!chainId) {
      chainId = this.configStore.getState().chainId;
    }
    const wholeState = this.allowStore.getState();
    let old = wholeState[chainId];
    const updateState = {
      [chainId]: {
        ...old,
        ...allowanceState,
      },
    };

    this.allowStore.updateState(updateState);
  }

  getChainAllowance(chainId) {
    const wholeState = this.allowStore.getState() || {};
    return wholeState[chainId] || {};
  }

  /**
   *
   * @param {string} key required
   * @param {number} chainId optional
   */
  lastEstimateGas(key, chainId) {
    if (!chainId) {
      chainId = this.configStore.getState().chainId;
    }

    const wholeState = this.estimateStore.getState();
    if (wholeState[chainId] && wholeState[chainId][key]) {
      return wholeState[chainId][key] || 0;
    }
    return 0;
  }

  getPendingTxs(chainId) {
    const txsState = this.txStore.getState();
    let pendingTxs = [];
    if (txsState && Object.values(txsState).length > 0) {
      pendingTxs = Object.values(txsState).filter(
        (tx) => tx.chainId === chainId && tx.statusText === TX_PENDING
      );
    }

    return pendingTxs;
  }

  updateMembershipDeadline(chainId, membershipDeadline) {
    let wholeState = this.statusStore.getState();
    if (chainId && membershipDeadline) {
      let chainState = wholeState[chainId] || {};
      const newState = {
        [chainId]: {
          ...chainState,
          membershipDeadline,
        },
      };

      this.statusStore.updateState(newState);
    }
  }

  /** --------------------------------- Signed Methods ------------------------------------ */
  async signedBTApproved4Member(reqData) {
    logger.debug('signedBTApproved4Member>>>>>>>>>>>>>>>>', reqData);
    const { reqId, gasPriceSwei = 0 } = reqData;
    if (!reqId) {
      throw new BizError('Miss parameter txReqId', PARAMS_ILLEGAL);
    }

    return await _signedApproved4Member.call(this, reqId, gasPriceSwei);
  }

  /**
   *
   * @param {object} reqData
   */
  async signedRegistedMemberByYear(reqData = {}) {
    logger.debug('signedBTApproved4Member>>>>>>>>>>>>>>>>', reqData);
    const { reqId, gasPriceSwei = 0 } = reqData;
    if (!reqId) {
      throw new BizError('Miss parameter reqId', PARAMS_ILLEGAL);
    }

    return await _signedRegistMember.call(this, reqId, gasPriceSwei, 1);
  }

  async signedWebsiteCommitCypher(reqId, gasPriceSwei, Cypher64) {
    return _SignedWebsiteCommitCypher.call(this, reqId, gasPriceSwei, Cypher64);
  }

  async signedMobileCommitCypher(reqId, gasPriceSwei, Cypher64) {
    return _SignedMobileCommitCypher.call(this, reqId, gasPriceSwei, Cypher64);
  }

  /**
   * @DateTime 2020-12-17
   * @param    {[object]}   txState [reqId,chainId,txHash] required [uid,statusText] optional
   * @return   {[array]}           [chainTxs]
   */
  async chainTxStatusUpdateForUI(txState) {
    const txs = await this.txStore.getState();
    const { chainId, reqId } = txState || {};
    if (!reqId || !chainId) {
      throw new BizError('TxState must contains reqId,chainId and txHash');
    }

    let uid = `${chainId}_${reqId}`;
    const oldState = txs[uid] || {};

    const newState = {
      [uid]: {
        ...oldState,
        ...txState,
      },
    };

    this.txStore.updateState(newState);

    return this.getChainTxs(chainId);
  }
}

function _initConfigState() {
  return {
    gasLimit: DEFAULT_GAS_LIMIT,
  };
}

/**
 *
 * @param {object} provider
 * @param {string} address hex string
 */
async function _reloadChainStatus(provider, address) {
  try {
    if (!provider || !address) {
      logger.debug('no provider so unhanlder set MemberCostWeiPerYear.');
      throw new BizError('params illegal.', PROVIDER_ILLEGAL);
    }
    const { chainId, rpcUrl } = provider;
    const web3js = getWeb3Inst(rpcUrl);
    const info = await APIManager.BPTMemberApi.getMemberBaseInFo(web3js, chainId, address);
    this.statusStore.updateState(info);
  } catch (err) {
    logger.debug('reload smart status failed.', err.message);
  }
}

async function _signedApproved4Member(reqId, gasPriceSwei) {
  const toWei = Web3.utils.toWei;
  const walletState = await this.getCurrentWalletState();
  if (
    !walletState ||
    !walletState.isUnlocked ||
    !walletState.dev3 ||
    !walletState.selectedAddress
  ) {
    throw new BizError('Extension logout or no account.', ACCOUNT_NOT_EXISTS);
  }

  const _provider = await this.getCurrentProvider();
  if (!_provider || !_provider.rpcUrl) {
    logger.debug('no provider so unhanlder set initialized.');
    return;
  }

  /** Inst init defined */
  const selectedAddress = walletState.selectedAddress;
  const { chainId, rpcUrl } = _provider;

  const { config = {} } = this.store.getState();
  const { chainStatus = {} } = this.getSendState(chainId);

  const web3js = getWeb3Inst(rpcUrl);
  const tokenInst = getBTContractInst(web3js, chainId, selectedAddress);
  const tokenAddress = tokenInst._address;

  let btsBalance = await tokenInst.methods.balanceOf(selectedAddress).call();

  // valid insuffient
  let memberCostWeiPerYear = chainStatus.memberCostWeiPerYear || MEMBER_COSTWEI_PER_YEAR;
  if (compareWei(btsBalance, memberCostWeiPerYear) < 0) {
    throw new BizError('Insuffient BT Balance.', INSUFFICIENT_BTS_BALANCE);
  }

  let { chain, gasPrice, gasStation = {} } = config;

  const approveAddress = getBptMemberAddress(chainId);

  // btsBalance = web3js.utils.toWei('11','ether');

  //
  const dataABI = tokenInst.methods.approve(approveAddress, btsBalance).encodeABI();

  let lastApproveGas = this.lastEstimateGas(BT_APPRPOVE_ESGAS, chainId); // config[BT_APPRPOVE_ESGAS];
  if (!lastApproveGas || lastApproveGas) {
    lastApproveGas = await tokenInst.methods
      .approve(approveAddress, btsBalance)
      .estimateGas({ from: selectedAddress });

    const updateGasState = { [BT_APPRPOVE_ESGAS]: lastApproveGas };
    this.emit('update:status:store:estimateGas', updateGasState, chainId);
  }

  // this will from custom UI set
  let gasLimit = parseInt(parseFloat(lastApproveGas) * GAS_LIMIT_PLUS_RATE);

  logger.debug('approveAddress:>>>BTs>', btsBalance, lastApproveGas);

  let avg = gasStation.average;
  if (gasPriceSwei && gasPriceSwei !== '0') {
    gasPrice = toWei((gasPriceSwei / 10).toString(), 'Gwei');
  } else if (avg && avg != '0') {
    gasPrice = toWei((avg / 10).toString(), 'Gwei');
  }

  let ethBal = await web3js.eth.getBalance(selectedAddress);
  const diamondsFee = validGasFeeEnought(ethBal, gasPrice, gasLimit);

  /** 组织参数 */
  const dev3 = walletState.dev3;

  const txParams = {
    gasLimit,
    gasPrice,
    value: 0,
    to: tokenAddress,
  };

  logger.debug('approveAddress:>>>BTs>', txParams, diamondsFee);

  const txData = await signedRawTxData4Method(web3js, dev3, txParams, dataABI, {
    chainId,
    chain,
    selectedAddress,
  });

  logger.debug('Web3 signed data hex string:', txData.nonce, txData.rawData);

  return {
    reqId,
    chainId,
    diamondsFee,
    willAllowance: btsBalance,
    nonce: txData.nonce,
    rawData: txData.rawData,
  };
}

/**
 *
 * @param {*} reqId
 */
async function _signedRegistMember(reqId, gasPriceSwei, charageType = 1) {
  const toWei = Web3.utils.toWei;
  const walletState = await this.getCurrentWalletState();
  logger.debug('_signedRegistMember>>>', walletState);
  if (
    !walletState ||
    !walletState.isUnlocked ||
    !walletState.dev3 ||
    !walletState.selectedAddress
  ) {
    throw new BizError('Extension logout or no account.', ACCOUNT_NOT_EXISTS);
  }
  const dev3 = walletState.dev3;
  const selectedAddress = walletState.selectedAddress;

  const _provider = await this.getCurrentProvider();
  if (!_provider || !_provider.rpcUrl) {
    logger.debug('no provider so unhanlder set initialized.');
    return;
  }

  const { chainId, rpcUrl } = _provider;

  const approveAddress = getBptMemberAddress(chainId);

  // Instance defined
  const web3js = getWeb3Inst(rpcUrl);
  const tokenInst = getBTContractInst(web3js, chainId, selectedAddress);
  const bptMemberInst = APIManager.BPTMemberApi.getBPTMemberContractInst(
    web3js,
    chainId,
    selectedAddress
  );

  const { config = {} } = this.store.getState();
  let { chain, gasPrice, gasStation = {} } = config;
  const { chainStatus = {} } = this.getSendState(chainId);
  let memberCostWeiPerYear =
    chainStatus.memberCostWeiPerYear || toWei(MEMBER_COSTWEI_PER_YEAR, 'ether');

  //check bts allownce
  const btsBalance = await tokenInst.methods.balanceOf(selectedAddress).call();
  if (compareWei(btsBalance, memberCostWeiPerYear) < 0) {
    throw new BizError('Insuffient BT balance.', INSUFFICIENT_BTS_BALANCE);
  }

  const allowBalance = await tokenInst.methods.allowance(selectedAddress, approveAddress).call();

  if (compareWei(allowBalance, memberCostWeiPerYear) < 0) {
    throw new BizError('Insuffient BT balance allowance.', INSUFFICIENT_BTS_BALANCE);
  }

  let gasLimit = this.lastEstimateGas(BPT_MEMBER_RECHARGE_ESGAS, chainId);

  if (!gasLimit) {
    gasLimit = await bptMemberInst.methods
      .RechargeByType(charageType)
      .estimateGas({ from: selectedAddress });

    const updateGasState = { [BPT_MEMBER_RECHARGE_ESGAS]: gasLimit };
    this.emit('update:status:store:estimateGas', updateGasState, chainId);
  }

  logger.debug('_signedRegistMember>>>', bptMemberInst, charageType);

  let avg = gasStation.average;
  if (gasPriceSwei > 0) {
    gasPrice = toWei((gasPriceSwei / 10).toString(), 'Gwei');
  } else if (avg > 0) {
    gasPrice = toWei((avg / 10).toString(), 'Gwei');
  }

  //check eth balance
  let ethBal = await web3js.eth.getBalance(selectedAddress);
  const diamondsFee = validGasFeeEnought(ethBal, gasPrice, gasLimit);

  const dataABI = bptMemberInst.methods.RechargeByType(charageType).encodeABI();

  const txParams = {
    gasLimit,
    gasPrice,
    value: 0,
    to: approveAddress,
  };

  const txData = await signedRawTxData4Method(web3js, dev3, txParams, dataABI, {
    chain,
    chainId,
    selectedAddress,
  });
  logger.debug('Web3 signed data hex string:', txData.nonce, txData.rawData);

  return {
    reqId,
    chainId,
    diamondsFee,
    nonce: txData.nonce,
    rawData: txData.rawData,
  };
}

async function _reloadConfig(provider, address) {
  try {
    if (!provider || !address) {
      logger.debug('no provider so unhanlder set MemberCostWeiPerYear.');
      return;
    }
    const { rpcUrl, chainId } = provider;
    const web3js = getWeb3Inst(rpcUrl);

    const chainConfig = await getChainConfig(web3js, address);
    logger.debug('_reloadConfig>>>>', chainConfig);

    this.configStore.updateState(chainConfig);
  } catch (err) {
    logger.debug('reload MemberCostWeiPerYear Failed.', err.message);
  }
}

async function _reloadBalances(provider) {
  if (!provider || !provider.rpcUrl) {
    logger.warn('Current Provdier Unset or RPCUrl illegal.', provider?.rpcUrl);
    throw new BizError('Provider Unset or illegal rpcUrl.', PROVIDER_ILLEGAL);
  }

  const accState = await this.getCurrentWalletState();
  if (!accState || !accState.isUnlocked) {
    logger.warn('get current account state fail', accState);
    throw new BizError('account not exists or logout', ACCOUNT_NOT_EXISTS);
  }

  try {
    const { rpcUrl, chainId } = provider;
    // dev3:MainPriKey,SubPriKey [uint8Array]
    const { selectedAddress } = accState;
    let web3js = getWeb3Inst(rpcUrl);
    // logger.debug('Web3Controller:reloadBalances>>>>', selectedAddress);

    const spenderAddress = getBptMemberAddress(chainId);
    let ethBalance = await web3js.eth.getBalance(selectedAddress);
    let btBalance = await APIManager.BTApi.getBalance(web3js, chainId, selectedAddress);
    let balances = {
      [chainId]: {
        [ETH_TOKEN]: ethBalance,
        [BT_TOKEN]: btBalance,
      },
    };

    const allowance = await APIManager.BTApi.getAllowance(
      web3js,
      chainId,
      selectedAddress,
      spenderAddress
    );

    const allowanceState = {
      [BPT_MEMBER]: allowance,
    };

    logger.debug('Web3Controller:reloadBalances>>>>', allowanceState);
    this.balanceStore.updateState(balances);
    this.setAllowanceState(allowanceState, chainId);

    logger.debug('Web3Controller:reloadBalances>>>>', allowanceState);

    // update membership
    const memberInfo = await getMemberBaseInFo(web3js, chainId, selectedAddress);
    this.statusStore.updateState(memberInfo);

    return this.getSendState(chainId);
  } catch (err) {
    logger.warn('Web3 disconnect.', err);
    throw new BizError(`Provider ${provider.rpcUrl} disconnected.`, NETWORK_UNAVAILABLE);
  }
}

async function _gasStation(url) {
  const opts = {
    timeout: 3000,
    withCredentials: true,
  };

  try {
    const resp = await axios.get(DEFAULT_GAS_STATION_URL, opts);
    if (resp && resp.status === 200 && resp.data) {
      let gasStation = resp.data;
      delete gasStation.gasPriceRange;
      logger.debug('Response:>>>>>', gasStation);
      this.configStore.updateState({ gasStation });

      return gasStation;
    } else {
      return false;
    }
  } catch (err) {
    logger.debug('Error>>>>>>', err);
  }
}

function _translateGasStation(configState) {
  const fromWei = Web3.utils.fromWei;
  let defaultGasPrice = DEFAULT_GAS_PRICE;

  if (configState && configState.gasPrice) {
    defaultGasPrice = configState['gasPrice'];
  }
  const { gasLimit = DEFAULT_GAS_LIMIT, gasStation } = configState;

  const averageGwei = fromWei(defaultGasPrice.toString(), 'Gwei');
  const defAvg = parseFloat(averageGwei) * 10;

  let gasState = {
    gasLimit,
    average: defAvg,
    safeLow: defAvg / 2,
    fast: defAvg,
    fastest: defAvg * 2,
    gasPrice: defAvg,
    ...gasStation,
  };

  return gasState;
}

async function _SignedWebsiteCommitCypher(reqId, gasPriceSwei, Cypher64) {
  const toWei = Web3.utils.toWei;
  const bytesToHex = Web3.utils.bytesToHex;
  const { chainId, rpcUrl } = await this.getCurrentProvider();
  const { isUnlocked, selectedAddress, dev3 } = await this.getCurrentWalletState();

  logger.debug('Website: _SignedWebsiteCommitCypher>>>>>>>>>>', Cypher64);
  if (!reqId || !Cypher64 || !chainId || !rpcUrl || !selectedAddress) {
    throw new BizError('Params illegal.', INTERNAL_ERROR);
  }

  if (!isUnlocked || !dev3 || !dev3.SubPriKey) {
    throw new BizError('Account logout.', WALLET_LOCKED);
  }

  const balanceState = await this.getBalanceState();

  const web3js = getWeb3Inst(rpcUrl);
  let ethwei = balanceState[ETH_TOKEN] || '0';

  const storageInst = getWebStorageEventInst(web3js, chainId, selectedAddress);

  const toContractAddress = storageInst._address;

  const cypherBytes = ExtractCommit(dev3.SubPriKey, Cypher64);
  const cypher64Hex = bytesToHex(cypherBytes);
  //valid sdk parse bytes
  validSdkExtractCommit(dev3.SubPriKey, cypherBytes);

  await _validMembership(web3js, chainId, selectedAddress);

  let gasLimitNumber = await this.lastEstimateGas(BPT_STORAGE_WEB_COMMIT_ESGAS, chainId);

  if (!gasLimitNumber) {
    logger.debug('gasLimit >>>>>>', gasLimitNumber, cypher64Hex);
    gasLimitNumber = await storageInst.methods
      .commit(cypher64Hex)
      .estimateGas({ from: selectedAddress });

    const updateGasState = {
      [BPT_STORAGE_WEB_COMMIT_ESGAS]: gasLimitNumber,
    };
    this.emit('update:status:store:estimateGas', updateGasState, chainId);
  }

  const { config = {} } = this.store.getState();
  let { chain, gasPrice, gasStation = {} } = config;
  let avg = gasStation.average;
  if (gasPriceSwei > 0) {
    gasPrice = toWei((gasPriceSwei / 10).toString(), 'Gwei');
  } else if (avg > 0) {
    gasPrice = toWei((avg / 10).toString(), 'Gwei');
  }

  // valid eth enought
  const diamondsFee = validGasFeeEnought(ethwei, gasPrice, gasLimitNumber);

  let dataABI = await storageInst.methods.commit(cypher64Hex).encodeABI();

  let txParams = {
    gasLimit: gasLimitNumber,
    gasPrice,
    value: 0,
    to: toContractAddress,
  };

  const txData = await signedRawTxData4Method(web3js, dev3, txParams, dataABI, {
    chain,
    chainId,
    selectedAddress,
  });

  logger.debug('_SignedWebsiteCommitCypher>>', txData.nonce, txData.rawData);

  return {
    reqId,
    chainId,
    rpcUrl,
    diamondsFee,
    paramHex: cypher64Hex,
    nonce: txData.nonce,
    rawData: txData.rawData,
  };
}

async function _SignedMobileCommitCypher(reqId, gasPriceSwei, Cypher64) {
  const toWei = Web3.utils.toWei;
  const bytesToHex = Web3.utils.bytesToHex;
  const { chainId, rpcUrl } = await this.getCurrentProvider();
  const { isUnlocked, selectedAddress, dev3 } = await this.getCurrentWalletState();

  if (!reqId || !Cypher64 || !chainId || !rpcUrl || !selectedAddress) {
    throw new BizError('Params illegal.', INTERNAL_ERROR);
  }

  if (!isUnlocked || !dev3 || !dev3.SubPriKey) {
    throw new BizError('Account logout.', WALLET_LOCKED);
  }

  const balanceState = await this.getBalanceState();

  const web3js = getWeb3Inst(rpcUrl);
  let ethwei = balanceState[ETH_TOKEN] || '0';
  const storageInst = getMobStorageEventInst(web3js, chainId, selectedAddress);

  const toContractAddress = storageInst._address;

  const cypherBytes = ExtractCommit(dev3.SubPriKey, Cypher64);
  const cypher64Hex = bytesToHex(cypherBytes);

  //valid sdk parse bytes
  validSdkExtractCommit(dev3.SubPriKey, cypherBytes);

  let gasLimit = this.lastEstimateGas(BPT_STORAGE_MOB_COMMIT_ESGAS, chainId);

  await _validMembership(web3js, chainId, selectedAddress);

  if (!gasLimit) {
    gasLimit = await storageInst.methods.commit(cypherBytes).estimateGas({ from: selectedAddress });

    const updateGasState = {
      [BPT_STORAGE_MOB_COMMIT_ESGAS]: gasLimit,
    };
    this.emit('update:status:store:estimateGas', updateGasState, chainId);
  }

  const { config = {} } = this.store.getState();
  let { chain, gasPrice, gasStation = {} } = config;
  let avg = gasStation.average;
  if (gasPriceSwei > 0) {
    gasPrice = toWei((gasPriceSwei / 10).toString(), 'Gwei');
  } else if (avg > 0) {
    gasPrice = toWei((avg / 10).toString(), 'Gwei');
  }

  // valid eth enought
  const diamondsFee = validGasFeeEnought(ethwei, gasPrice, gasLimit);

  let dataABI = await storageInst.methods.commit(cypher64Hex).encodeABI();

  let txParams = {
    gasLimit,
    gasPrice,
    value: 0,
    to: toContractAddress,
  };

  const txData = await signedRawTxData4Method(web3js, dev3, txParams, dataABI, {
    chain,
    chainId,
    selectedAddress,
  });

  logger.debug('_SignedMobileCommitCypher>>', txData.nonce, txData.rawData);

  return {
    reqId,
    chainId,
    rpcUrl,
    diamondsFee,
    paramHex: cypher64Hex,
    nonce: txData.nonce,
    rawData: txData.rawData,
  };
}

function validSdkExtractCommit(subPriKey, cypherBytes) {
  var chainData = new ChainCmdArray();
  chainData.DecryptChainCmdArray(subPriKey, cypherBytes);

  logger.debug('>>>>>>>>>>>>', chainData);

  // throw new BizError('ooo',INTERNAL_ERROR);
  if (!chainData.data || !chainData.data.length) {
    throw new BizError('call Sdk ExtractCommit err', INTERNAL_ERROR);
  }
}

async function _validMembership(web3js, chainId, address) {
  const inst = getBPTMemberContractInst(web3js, chainId, address);
  const membershipDeadline = await inst.methods.allMembership(address).call();

  if (!membershipDeadline || membershipDeadline == '0') {
    throw new BizError('non-member', MEMBERSHIP_EXPIRED);
  }

  if (new Date().getTime() / 1000 - parseFloat(membershipDeadline) > 0) {
    const expiredDate = moment(new Date(membershipDeadline * 1000)).format('YYYY-MM-DD');
    throw new BizError(`Membership Expired : [${expiredDate}]`, MEMBERSHIP_EXPIRED);
  }
}

export default Web3Controller;
