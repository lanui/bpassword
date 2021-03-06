import { debounce } from 'lodash';
import ObservableStore from 'obs-store';

import logger from '@lib/logger';
import BaseController from './base-controller';
import Zombie from '@lib/messages/corpse-chaser';
import { ifrSizeCalcWhenValtChanged } from '@lib/controllers/size-calculator';

import {
  API_WIN_FINDED_LOGIN,
  API_WIN_SELECTOR_DRAWER,
  API_WIN_SELECTOR_TOGGLE,
  API_WIN_SELECTOR_ERASER,
  API_WIN_SELECTOR_ERASER_FORCE,
  API_WIN_SELECTOR_UP_POSITION,
  API_WIN_SELECTOR_UP_VALT,
  API_WIN_SELECTOR_UP_DRAWER,
  API_PORT_FIELDS_VALT_CHANGED,
  API_RT_FIELDS_VALT_CHANGED,
} from '@lib/msgapi/api-types';
import { ENV_TYPE_INJET } from '@lib/enums';

import { BPASS_BUTTON_TAG, BpassButton } from './bpass-button';

/*********************************************************************
 * AircraftClass ::
 *    @description:
 *    @description:
 * WARNINGS:
 *    ResizeObserve Firefox must >= 69 & Chrome >= 64 & Edge >=79
 *
 * HISTORY:
 *    @author: lanbery@gmail.com
 *    @created:  2020-11-25
 *    @comments:
 **********************************************************************/

export const PASSWORD_SELECTOR = 'input[type="password"][name],input[type="password"]';
export const USERNAME_SELECTOR =
  'input[type="mail"][name],input[type="text"][name],input[type="text"][id],input[type="text"]';

class FieldController extends BaseController {
  constructor({ extid }) {
    super({ type: '__bpfield_' });
    this.extid = extid;
    this.enabledFocusout = true;

    this.backendStore = new ObservableStore({ isUnlocked: false, items: [], matchedNum: 0 });

    /** ------- event -------- */

    this.mutationObserver = new MutationObserver(
      debounce(this.mutationObserverListener.bind(this), 15)
    );
    if (window.document.body && window.document.body.childElementCount > 0) {
      this.mutationObserver.observe(document.body, {
        childList: true, //
        subtree: true, //
        attributes: true, //
      });
    }

    this.on('lookup:login:fields', this.checkLoginForm.bind(this));
    this.on('enabled:input:valtChanged', this.enabledInputFieldValtChangedListener.bind(this));
    this.on('disabled:input:valtChanged', this.disabledInputFieldValtChangedListener.bind(this));

    this.once('actived:zombie-communication', this.activedZombieCommunication.bind(this));
    this.once('enabled:resize:obs', this.enabledPositionResizeObserve.bind(this));

    this.once('enabled:private:msg-listener', this.enabledSelfPrivateMsgListener.bind(this));
    this.once('actived:login:window:scroll-obs', this.activedLoginWindowScrollObs.bind(this));
    /* ------------ bind ------- */
  }

  /** =========================== Event Methods Start ============================== */

  activedLoginWindowScrollObs() {
    window.addEventListener('scroll', debounce(this.loginWindowScrollHandler.bind(this), 100));
  }

  loginWindowScrollHandler(el) {
    const target = this.activedTarget || this.targetUsername || this.targetPassword;
    if (target) {
      this.sendTargetPosition(target);
      _updateBpassButtonPoistion.call(this, target);
    }
  }

  mutationObserverListener(records) {
    if (!this.targetPassword || !this.targetUsername) {
      const { targetPassword, targetUsername } = lookupLoginFeildsInDom();
      this.targetPassword = targetPassword;
      this.targetUsername = targetUsername;

      if (targetPassword && targetUsername) {
        this.emit('actived:login:window:scroll-obs');
        const hostname = this.getHost();
        if (window.self !== window.top) {
          this.emit('enabled:private:msg-listener');
        }

        BindingFocusEvents.call(this);
        this.emit('enabled:resize:obs');
        // send API_WIN_FINDED_LOGIN Message
        const findedData = {
          isInner: window.self !== window.top,
          senderId: this.getId(),
          href: window.location.href,
          hostname: hostname,
        };

        this._sendMessageToTop(API_WIN_FINDED_LOGIN, findedData);

        // emit active Long connect background
        this.emit('actived:zombie-communication', hostname);
      }
    }

    if (
      this.targetPassword &&
      this.targetPassword.getBoundingClientRect() &&
      this.targetPassword.getBoundingClientRect().width === 0
    ) {
      // send selector box display
      this.sendEraseSelectorBoxMessage(true);
    }
  }
  /**
   *
   */
  enabledSelfPrivateMsgListener() {
    const selfId = this.getId();
    window.addEventListener('message', (evt) => {
      if (!evt.data || (evt.data.token !== selfId && !evt.data.command)) {
        return;
      }
      logger.debug('FieldController::enabledSelfPrivateMsgListener>>>', evt.data);
      const target = this.activedTarget || this.targetUsername || this.targetPassword;
      const { command } = evt.data;
      switch (command) {
        case 'resize':
        case 'scroll':
          target && this.sendTargetPosition(target);
          break;
        default:
          break;
      }
    });
  }

  /**
   * 开启热size 监控
   */
  enabledPositionResizeObserve() {
    // logger.debug('activedPositionResizeObserve>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>')
    this.resizeObserver = new ResizeObserver(debounce(this.resizePisitonHandler.bind(this), 100));
    this.resizeObserver.observe(document.body);
  }

  /**
   * Firefox :
   * @param {*} entries
   */
  resizePisitonHandler(entries) {
    // logger.debug('activedPositionResizeObserve>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>', entries,this)

    let target = this.activedTarget || this.targetUsername || this.targetPassword;

    if (!target) {
      return;
    }
    // logger.debug('activedPositionResizeObserve>>>>>>>>>after>>>>>>>>>>>>>>>>>>>>>>>>>>>', target)

    //update icon position
    _updateBpassButtonPoistion.call(this, target);
    this.sendTargetPosition(target);
  }

  /**
   *
   * @param {string} hostname must
   */
  activedZombieCommunication(hostname) {
    const opts = {
      hostname,
      portName: ENV_TYPE_INJET,
      includeTlsChannelId: false,
      updateMatchedState: this.updateBackendStore.bind(this),
      filledInputFeilds: this.filledInputFields.bind(this),
    };

    this.zombie = new Zombie(opts);
    this.zombie.startupZombie({ hostname });
  }

  enabledInputFieldValtChangedListener(el) {
    // logger.debug('FieldController:enabledInputFieldValtChangedListener#on>>>>>>', el);
    el &&
      el.addEventListener(
        'input',
        debounce(this.inputFieldValtChangedHandler.bind(this, el), 800),
        true
      );
  }

  disabledInputFieldValtChangedListener(el) {
    el && el.removeEventListener('input', this.inputFieldValtChangedHandler.bind(this), true);
  }

  /**
   *
   * @param {*} target
   */
  inputFieldValtChangedHandler(target) {
    const valtState = this.getValtState(target);

    this._sendMessageToTop(API_WIN_SELECTOR_UP_VALT, valtState);
    logger.debug('inputFieldValtChangedHandler>>>', target, valtState);
    // send to backend
    if (this.zombie) {
      this.zombie.postMessage(API_RT_FIELDS_VALT_CHANGED, valtState);
    }

    /** API_WIN_SELECTOR_UP_DRAWER */
    let activedDomRect = target.getBoundingClientRect();
    let serializeDomRect = JSON.parse(JSON.stringify(activedDomRect));

    //

    const paramState = this._comboParams(target);
    const ifrSizeState = ifrSizeCalcWhenValtChanged(paramState, true);

    logger.debug(
      'inputFieldValtChangedHandler::>ifrSizeCalcWhenValtChanged>>>>>>>>>>>>>>>',
      JSON.stringify(ifrSizeState)
    );

    const { elemType, ifrHeight, tag } = ifrSizeState;
    const drawMessageData = this.comboSelectorBoxSendData(ifrHeight, serializeDomRect);

    if (elemType === 'drawing') {
      logger.debug('inputFieldValtChangedHandler>>>', elemType, tag, drawMessageData);
      this._sendMessageToTop(API_WIN_SELECTOR_UP_DRAWER, drawMessageData);
    } else if (elemType === 'erase') {
      this._sendMessageToTop(API_WIN_SELECTOR_ERASER, { from: 'input:fields:changed' });
    }
  }

  /** =========================== Methods Start ============================== */

  updateBackendStore(state) {
    if (typeof state === 'object') {
      this.backendStore.updateState(state);
    }
  }

  filledInputFields(valtState) {
    if (typeof valtState !== 'object') {
      return;
    }
    // logger.debug(`WhisperListener Received Data>filledFieldValt>>`, valtState, this.targetUsername, this.targetPassword);
    const { username = '', password = '' } = valtState;

    this.targetUsername && (this.targetUsername.value = username);
    this.targetPassword && (this.targetPassword.value = password);
  }

  /**
   * lookup password & username field element
   */
  checkLoginForm() {
    const { targetPassword, targetUsername } = lookupLoginFeildsInDom();
    this.targetPassword = targetPassword;
    this.targetUsername = targetUsername;

    const hasFinded = targetPassword && targetUsername;

    if (hasFinded) {
      const hostname = this.getHost();
      logger.debug('checkLoginForm>>>>>>>>>>>>>>', this.targetUsername, this.targetUsername);
      this.emit('actived:login:window:scroll-obs');
      if (window.self !== window.top) {
        //enabled listening message from top
        this.emit('enabled:private:msg-listener');
      }

      /**
       *
       * 0.bind focus events
       * 1.emit active Long connect background
       * 2.send message parent
       * 3.send message top -> create Long connect background
       * 4.emit valtChanged Listener
       * 5.emit scroll:obs
       *
       */

      BindingFocusEvents.call(this);

      // actived resize observe
      this.emit('enabled:resize:obs');

      // send API_WIN_FINDED_LOGIN Message
      const findedData = {
        isInner: window.self !== window.top,
        senderId: this.getId(),
        href: window.location.href,
        hostname: hostname,
      };

      this._sendMessageToTop(API_WIN_FINDED_LOGIN, findedData);

      // emit active Long connect background
      this.emit('actived:zombie-communication', hostname);
    }
  }

  _sendMessageToTop(apiType, data) {
    const sendMessage = {
      apiType,
      data,
    };
    window.top.postMessage(sendMessage, '*');
  }

  _sendTrustedMessageToTop(apiType, data) {
    const sendMessage = {
      apiType,
      data,
    };
    window.top.postMessage(sendMessage, '*');
  }

  /**
   * warning : activeField -> activedField
   * @param {element} activedTarget
   */
  _comboParams(activedTarget) {
    const valtState = this.getValtState(activedTarget);
    const backendState = this.backendStore.getState();
    return { ...backendState, ...valtState };
  }

  setActivedTarget(target) {
    this.activedTarget = target || null;
  }

  /**
   *
   * @param {boolean} force
   */
  sendEraseSelectorBoxMessage(force = false) {
    const sendMessage = {
      apiType: !force ? API_WIN_SELECTOR_ERASER : API_WIN_SELECTOR_ERASER_FORCE,
      data: { force },
    };
    window.top.postMessage(sendMessage, '*');
  }

  /**
   * BPass icon click toggle selector
   * @param {element} activedTarget
   */
  iconClickHandler(activedTarget) {
    if (!activedTarget) {
      logger.debug('iconClickHandler::return;>>>>>>>>>>>>>>>>', activedTarget);
      return;
    }

    //first send activedFieldPosition to posiChains
    this.sendTargetPosition(activedTarget);

    let activedDomRect = activedTarget.getBoundingClientRect();
    let serializeDomRect = JSON.parse(JSON.stringify(activedDomRect));

    // const activedValtState = this.getValtState(activedTarget);

    const paramState = this._comboParams(activedTarget);
    const ifrSizeState = ifrSizeCalcWhenValtChanged(paramState);

    const { elemType, ifrHeight, tag } = ifrSizeState;
    logger.debug(
      'iconClickHandler::toggler>ifrSizeCalcWhenValtChanged>>>>>>>>>>>>>>>',
      JSON.stringify(ifrSizeState)
    );
    const drawMessageData = this.comboSelectorBoxSendData(ifrHeight, serializeDomRect);

    this._sendMessageToTop(API_WIN_SELECTOR_TOGGLE, drawMessageData);
  }

  /**
   * actived the first Position chain message
   * or position changed
   * @param {element} activedTarget
   */
  sendTargetPosition(activedTarget) {
    if (
      !activedTarget ||
      !activedTarget.getBoundingClientRect() ||
      activedTarget.getBoundingClientRect().width === 0
    ) {
      return;
    }

    let domRect = activedTarget.getBoundingClientRect();
    const transportMsg = {
      posterId: this.getId(),
      extid: this.extid,
      nodeRootHref: window.location.href,
      domRects: [
        {
          uuid: this.getId(),
          domRect: JSON.parse(JSON.stringify(domRect)),
          iframeSrc: window.location.href,
          activedField: activedTarget === this.targetUsername ? 'username' : 'password',
        },
      ],
    };
    logger.debug(
      'sendTargetPosition:actived or changed Position chain message*****>>>',
      transportMsg,
      activedTarget
    );
    window.parent.postMessage(transportMsg, '*');
  }

  /**
   *
   * @param {*} activedTarget
   */
  getValtState(activedTarget) {
    const valtState = {
      activedField:
        activedTarget && activedTarget === this.targetPassword ? 'password' : 'username',
      hostname: this.getHost(),
      username: this.targetUsername ? this.targetUsername.value : '',
      password: this.targetPassword ? this.targetPassword.value : '',
    };

    return valtState;
  }

  /**
   * @deprecated
   */
  getLevelNum() {
    if (window.self === window.top) {
      return 0;
    }
    if (window.self !== window.top && window.parent === window.top) {
      return 1;
    }
    return 2;
  }

  /**
   * selector params :
   *  left,top,width,height optional
   *  ifrHeight must
   * @param {json} serializeDomRect
   * @param {number} ifrHeight
   */
  comboSelectorBoxSendData(ifrHeight, serializeDomRect) {
    serializeDomRect = serializeDomRect || {
      width: 0,
      height: 0,
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      x: 0,
      y: 0,
    };

    /**
     * selector params :
     * left: 0,top:0,width:0 optional
     * height,ifrHeight: must
     * isInner,atHref optional
     */
    let baseParam = {
      isInner: window.self !== window.top,
      atHref: window.location.href,
    };

    return { ...serializeDomRect, ...baseParam, ifrHeight };
  }
}

/** ++++++++++++++++++++++++++ Functions Start ++++++++++++++++++++++++++++++ */

function BindingFocusEvents() {
  const ctx = this;

  if (ctx.targetPassword) {
    bindingActivedFocusEvents(ctx.targetPassword);
  }
  if (ctx.targetUsername) {
    bindingActivedFocusEvents(ctx.targetUsername);
  }

  function bindingActivedFocusEvents(elem) {
    if (!elem) return;

    /**
     * Focusin
     */
    elem.addEventListener('focusin', (e) => {
      e.target.setAttribute('autocomplete', 'off');

      ctx.setActivedTarget(e.target);

      // send message to top & jet message listener
      ctx.sendTargetPosition(e.target);

      const activedValtState = ctx.getValtState(e.target);

      // send valtState to background
      if (ctx.zombie) {
        ctx.zombie.postMessage(API_RT_FIELDS_VALT_CHANGED, activedValtState);
      }

      // enabled:input:valtChanged event
      ctx.emit('enabled:input:valtChanged', e.target);

      drawBPassButtonRoot.call(ctx, e);

      /** 判断如何弹框和弹框高度 */
      const paramState = ctx._comboParams(e.target);
      const ifrSizeState = ifrSizeCalcWhenValtChanged(paramState);

      const { elemType, ifrHeight, tag } = ifrSizeState;
      const activedDomRect = e.target.getBoundingClientRect();

      logger.debug(
        'FieldController::bindingActivedFocusEvents@focusin--ifrSizeCalcWhenValtChanged>>',
        tag,
        elemType,
        ifrSizeState
      );
      if (elemType === 'drawing') {
        const drawMessageData = ctx.comboSelectorBoxSendData(ifrHeight, activedDomRect);
        ctx._sendMessageToTop(API_WIN_SELECTOR_DRAWER, drawMessageData);
      } else if (elemType === 'erase') {
        ctx.sendEraseSelectorBoxMessage(false);
      } else {
        /** do nothing. */
      }
    });

    elem.addEventListener('focusout', (e) => {
      // disabled:input:valtChanged
      ctx.emit('disabled:input:valtChanged', e.target);

      if (ctx.enabledFocusout) {
        logger.debug('FieldController@focusout ::remove>>>');
        //remove icon when focusout
        document.querySelector(BPASS_BUTTON_TAG) &&
          document.querySelector(BPASS_BUTTON_TAG).remove();

        // send selector box display
        ctx.sendEraseSelectorBoxMessage(false);
      }

      ctx.setActivedTarget(null);
    });
  }
}

function drawBPassButtonRoot(e) {
  let domRect = e.target.getBoundingClientRect();
  domRect = JSON.parse(JSON.stringify(domRect));

  // logger.debug('drawBPassButtonRoot>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>', domRect);

  /** window pointer to target window */
  if (!window.customElements.get(BPASS_BUTTON_TAG)) {
    try {
      window.customElements.define(BPASS_BUTTON_TAG, BpassButton);
    } catch (error) {
      logger.warn('Registed Bpass-button failed.', error.message);
    }
  }

  let passRoot = document.querySelector(BPASS_BUTTON_TAG);
  if (passRoot) {
    passRoot.remove();
  }
  passRoot = document.createElement(BPASS_BUTTON_TAG);
  document.body.appendChild(passRoot);
  setDomRect(passRoot, domRect);
  const _ctx = this;
  passRoot.onClick = _ctx.iconClickHandler.bind(_ctx, e.target);

  return passRoot;
}

function _updateBpassButtonPoistion(target) {
  const bpassButton = document.querySelector(BPASS_BUTTON_TAG);
  logger.debug('activedPositionResizeObserve>>_updateBpassButtonPoistion>>>>>', bpassButton);
  if (target && bpassButton) {
    let domRect = JSON.parse(JSON.stringify(target.getBoundingClientRect()));
    setDomRect(bpassButton, domRect);
  }
}

function setDomRect(elem, domRect) {
  const { left = 0, top = 0, width = 0, height = 0 } = domRect;

  elem.setAttribute('target-width', width);
  elem.setAttribute('target-height', height);
  elem.setAttribute('target-left', left);
  elem.setAttribute('target-top', top);
}

function lookupLoginFeildsInDom() {
  const ret = {
    targetPassword: null,
    targetUsername: null,
  };

  let _password = window.document.querySelector(PASSWORD_SELECTOR);

  if (!_password) {
    return ret;
  } else {
    //Fixed 163.com has two password input fields
    if (_password.style.display === 'none') {
      // logger.debug('163.com >>>>', _password.style.display);
      window.document.querySelectorAll(PASSWORD_SELECTOR).forEach((el) => {
        if (el.style.display !== 'none') {
          _password = el;
        }
      });
    }
  }

  let _username = null;

  if (_password.form) {
    //Fixed 163.com has two password
    _username =
      _password.form.querySelector(USERNAME_SELECTOR) &&
      _password.form.querySelector(USERNAME_SELECTOR).style.display !== 'none'
        ? _password.form.querySelector(USERNAME_SELECTOR)
        : null;

    //fixed pan|yun.baidu.com
    _username =
      _username &&
      _username.getBoundingClientRect() &&
      _username.getBoundingClientRect().width === 0
        ? null
        : _username;
  }

  if (_password && !_username) {
    _username = recursiveQuery(_password, USERNAME_SELECTOR);
    //document.body.querySelector(USERNAME_SELECTOR);
  } else {
    logger.debug(
      'FeildController:mutationObsHandler:recursiveQuery>>>>>>>>>>>>>>>>>',
      _username.getBoundingClientRect()
    );
  }

  logger.debug('Lookup login fields:', _password, _username);
  if (!_password || !_username) {
    return ret;
  }

  return {
    targetPassword: _password,
    targetUsername: _username,
  };
}

/**
 * lookup target field logic
 * @param {*} target
 * @param {*} selector
 */
function recursiveQuery(target, selector) {
  if (!target) return null;
  const parentElem = target.parentElement || null;
  if (!parentElem || (!!parentElem.tagName && parentElem.tagName.toLowerCase() === 'body')) {
    return null;
  }

  let findElem = null;

  //fixed baidu&sina&163 has two feild and first display:none
  parentElem.querySelectorAll(selector).forEach((el) => {
    // fixed sina has multi input
    // find parent>first> display
    if (findElem === null && el.style.display !== 'none') {
      findElem = el;
      // logger.debug('find TargetUsername&&&&>>>>>>>>>>>>>>>>>', findElem);
    }

    //fixed Baidu dynamic
    if (
      findElem &&
      findElem.getBoundingClientRect() &&
      findElem.getBoundingClientRect().width === 0
    ) {
      if (el.getBoundingClientRect() && el.getBoundingClientRect().width > 0) {
        findElem = el;
      }
    }
  });

  if (!findElem || findElem.style.display === 'none') {
    return recursiveQuery(parentElem, selector);
  } else {
    return findElem;
  }
}

export default FieldController;
