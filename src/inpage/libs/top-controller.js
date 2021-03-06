import ObservableStore from 'obs-store';
import { debounce } from 'lodash';

import logger from '@lib/logger';

import Zombie from '@lib/messages/corpse-chaser';
import BaseController from './base-controller';
import { ENV_TYPE_INJET_TOP } from '@lib/enums';
import { SELECTOR_BOX_TAG } from '../chanel-five';

/*********************************************************************
 * AircraftClass ::
 *    @description: Page Top Iframe controller,management the leech box
 *    @description:
 * WARNINGS:
 *
 * HISTORY:
 *    @author: lanbery@gmail.com
 *    @created:  2020-10-27
 *    @comments: 2020-11-25 firefox refactor
 *      bacause firefox content script can't get extension id,
 *      so all dependencies extid resources need fetch back used message
 *      at instance lifetime
 **********************************************************************/
class TopController extends BaseController {
  constructor({ initConfig }) {
    super({ type: 'BPTopCtx_' });

    this.initConfig = initConfig || {};

    /** login fields Valt */
    this.fieldValtState = new ObservableStore({
      activedField: '',
      username: '',
      password: '',
      hostname: '',
    });

    /** backend state */
    this.backendStore = new ObservableStore({
      isUnlocked: false,
      items: [],
      matchedNum: 0,
      exactMatched: false,
    });

    // logger.debug('>>>TopController>>>>>>>>>>>>>>>>>>', this.getId());

    /** ---------  ---------- */
    this.once('actived:zombie-communication', this.createAndStartupZombieCommunication.bind(this));
    this.once('actived:resize:obs', this.activedTopBodyResizeObserve.bind(this));
    this.once('actived:window:srcoll:obs', this.activedMultiLayerScrollObserver.bind(this));

    /** Bind Box Method begin */
    this.createSelectorBox = _createSelectorBox.bind(this);
    this.updateBoxIfrHeight = _updateSelectorBoxIfrHeight.bind(this);
    // this.eraseSelectorBox = _removeSelectorBox.bind(this);
  }

  /* +++++++++++++++++++++++++ Events & Listeners begin +++++++++++++++++++++++++++++ */
  createAndStartupZombieCommunication(hostname) {
    this.zombie = new Zombie({
      portName: ENV_TYPE_INJET_TOP,
      updateMatchedState: this.updateBackendStoreHandler.bind(this),
    });

    this.zombie.startupZombie({ hostname });
  }

  /**
   * 开启热size监控,multi layer need top notify login
   */
  activedTopBodyResizeObserve() {
    this.resizeObserver = new ResizeObserver(debounce(this.topBodyResizeHandle.bind(this), 100));
    this.resizeObserver.observe(document.body);
  }

  topBodyResizeHandle(entries) {
    if (this.isInner && this.loginSource && this.loginOrigin && this.loginUUID) {
      logger.debug('FJS:topInjet TopController::topBodyResizeHandle>>>>>>>>>>', this.loginOrigin);
      const message = {
        token: this.loginUUID,
        command: 'resize',
        form: this.getId(),
        data: { ts: new Date().getTime() },
      };
      logger.debug(
        'FJS:topInjet TopController::topBodyResizeHandle>>>>>>>>>>',
        message,
        this.loginSource
      );
      this.loginSource.postMessage(message, this.loginOrigin);
    }
  }

  activedMultiLayerScrollObserver() {
    window.addEventListener('scroll', debounce(this.topLayerWindowScrollHandler.bind(this), 100));
  }

  topLayerWindowScrollHandler() {
    if (this.isInner && this.loginSource && this.loginOrigin && this.loginUUID) {
      logger.debug(
        'FJS:topInjet TopController::topLayerWindowScrollHandler>>>>>>>>>>',
        this.loginOrigin
      );
      const message = {
        token: this.loginUUID,
        command: 'scroll',
        form: this.getId(),
        data: { ts: new Date().getTime() },
      };
      logger.debug(
        'FJS:topInjet TopController::topLayerWindowScrollHandler>>>>>>>>>>',
        message,
        this.loginSource
      );
      this.loginSource.postMessage(message, this.loginOrigin);
    }
  }
  /**
   * 更新backend data
   *
   */
  updateBackendStoreHandler(state) {
    this.backendStore.updateState({ ...state });
    // logger.debug('updateBackendStoreHandler:>>>>>>>>>>>>>>>>>>>>>>>', state);
  }

  updateFieldValtStoreHandler(valtState) {
    this.fieldValtState.updateState(valtState);
  }

  /* ####################### Handle Top Message Starting ######################### */
  updatefindedMessageHandler(data, evt) {
    // logger.debug('FJS:topInjet updatefindedMessageHandler@sendMessage>>>>>>>>>>>>>>>>>>>>>>>', evt);
    const { hostname = '', isInner = false, href = '', senderId } = data;
    this.loginHostname = hostname;
    this.loginHref = href;
    this.isInner = isInner;

    //startup communication
    this.emit('actived:zombie-communication', hostname);

    // actived:resize:obs
    if (isInner && senderId) {
      this.loginSource = evt.source;
      this.loginOrigin = evt.origin;
      this.loginUUID = senderId;
      this.emit('actived:resize:obs');
      this.emit('actived:window:srcoll:obs');
      // logger.debug('FJS:topInjet updatefindedMessageHandler@sendMessage>>>>>>>>>>>>>>>>>>>>>>>', senderId, this.loginOrigin);
    }
  }

  drawingSelector(data) {
    logger.debug('TopController:drawingSelector>>>', data);
    const ifrSrc = this.getLeechSrc();
    _createSelectorBox.call(this, ifrSrc, data);
    // this.createSelectorBox(ifrSrc, data);
  }

  eraseSelectorBox(force = false) {
    _removeSelectorBox.call(this, force);
  }

  toggleSelectorBox(data) {
    const box = document.querySelector(SELECTOR_BOX_TAG);
    // logger.debug('toggleSelectorBox-->>>>>>>>>..', !!box, data);
    !box ? this.drawingSelector(data) : this.eraseSelectorBox(false);
  }

  /**
   * 负责创建或更新高度
   * @param {object} data
   */
  drawOrUpdateSelectorBoxIframeHeight(data) {
    // logger.debug('TopController::drawOrUpdateSelectorBoxIframeHeight ->>', data);
    const exists = !!document.querySelector(SELECTOR_BOX_TAG);

    if (exists) {
      if (document.querySelector(SELECTOR_BOX_TAG).hasAttribute('is-addor')) {
        /** addor status no update styles */
      } else {
        const { ifrHeight } = data;
        _updateSelectorBoxIfrHeight.call(this, { ifrHeight, isAddor: false });
      }
    } else {
      const ifrSrc = this.getLeechSrc();
      _createSelectorBox.call(this, ifrSrc, data);
    }
  }

  /**
   *
   * @param {*} param0
   */
  updateSelectorBoxIfrHeight({ ifrHeight, isAddor = false }) {
    // logger.debug('updateSelectorBoxIfrHeight',ifrHeight)
    _updateSelectorBoxIfrHeight.call(this, { ifrHeight, isAddor });
  }

  /* ********************* Commons Methods Begin **************************** */
  getExtId() {
    const extid = this.initConfig.extid || '';
    if (!extid) {
      logger.warn('TopController unfound extid.');
    }

    return extid;
  }

  getLeechSrc() {
    const src = this.initConfig.leechSrc || '';
    if (!src) {
      logger.warn('TopController unset leechSrc property.');
    }
    return src;
  }
}

/** ----------------------------- Private Functions Begin --------------------------------- */

/**
 *
 * @param {string} src
 * @param {Object} position
 */
function _createSelectorBox(src, position) {
  if (!position || !position.ifrHeight || !position.width) {
    logger.warn('Params miss>>>', position);
  }
  const { left = 0, top = 0, width = 0, height, ifrHeight, isInner, atHref = '' } = position;
  let box = document.querySelector(SELECTOR_BOX_TAG);
  logger.debug('ToopController::_createSelectorBox->>>', box, position);
  const exists = !!box;

  if (exists && box.hasAttribute('is-addor')) {
    box.setAttribute('uts', new Date().getTime());
    return;
  }

  if (!exists) {
    box = document.createElement(SELECTOR_BOX_TAG);
  }
  box.setAttribute('uts', new Date().getTime());
  if (!exists) {
    box.setAttribute('src', src);
  }
  box.setAttribute('at-width', width);
  box.setAttribute('at-height', height);
  box.setAttribute('at-left', left);
  box.setAttribute('at-top', top);
  box.setAttribute('ifr-height', ifrHeight);
  if (isInner) {
    box.setAttribute('is-inner', isInner);
  } else {
    box.hasAttribute('is-inner') && box.removeAttribute('is-inner');
  }

  if (atHref) {
    box.setAttribute('at-href', atHref);
  }

  if (!exists) {
    document.body.insertAdjacentElement('beforeend', box);
  }
}

function _updateSelectorBoxIfrHeight({ ifrHeight, isAddor = false }) {
  logger.debug('_updateSelectorBoxIfrHeight>>>>>>>>>>>>', ifrHeight);
  if (!ifrHeight) {
    return;
  }
  let box = document.querySelector(SELECTOR_BOX_TAG);
  if (box) {
    box.setAttribute('ifr-height', parseInt(ifrHeight));
    if (isAddor) {
      box.setAttribute('is-addor', true);
    } else {
      box.removeAttribute('is-addor');
    }
  }
}

function _removeSelectorBox(force = false) {
  const box = document.querySelector(SELECTOR_BOX_TAG);
  if (box) {
    force ? box.remove() : !box.hasAttribute('is-addor') && box.remove();
  }
}

function _updateSelectorBoxPositionOnly(domRect) {}

export default TopController;
