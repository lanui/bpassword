import { debounce, clone } from 'lodash';
import ObservableStore from 'obs-store';

import logger from '@lib/logger';
import BaseController from './base-controller';
import Zombie from '@lib/messages/corpse-chaser';
import { ifrSizeCalcWhenValtChanged } from '@lib/controllers/size-calculator';

import {
  API_WIN_FINDED_LOGIN,
  API_WIN_SELECTOR_DRAWER,
  API_WIN_SELECTOR_ERASER,
  API_WIN_SELECTOR_ERASER_FORCE,
  API_WIN_SELECTOR_UP_POSITION,
  API_WIN_SELECTOR_UP_VALT,
  API_WIN_SELECTOR_UP_DRAWER,
  API_PORT_FIELDS_VALT_CHANGED,
} from '@lib/msgapi/api-types';
import { ENV_TYPE_INJET } from '@lib/enums';

import { BPASS_BUTTON_TAG, BpassButton } from './bpass-button';

/*********************************************************************
 * AircraftClass ::
 *    @description:
 *    @description:
 * WARNINGS:
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

    this.backendStore = new ObservableStore({ isUnlocked: false, items: [], matchedNum: 0 });

    /** ------- event -------- */
    this.on('lookup:login:fields', this.checkLoginForm.bind(this));
    this.on('enabled:input:valtChanged', this.enabledInputFieldValtChangedListener.bind(this));
    this.on('disabled:input:valtChanged', this.disabledInputFieldValtChangedListener.bind(this));

    this.once('actived:zombie-communication', this.activedZombieCommunication.bind(this));
  }

  /** =========================== Event Methods Start ============================== */

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
    logger.debug('FieldController:enabledInputFieldValtChangedListener#on>>>>>>', el);
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
    // logger.debug('inputFieldValtChangedHandler>>>', target, valtState);
    this._sendMessageToTop(API_WIN_SELECTOR_UP_VALT, valtState);
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
    const { username = '', password = '' } = valtState;

    this.targetUsername && (this.targetUsername.value = username);
    this.targetPassword && (this.targetPassword.vaule = password);
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
   * BPass icon click toggle selector
   * @param {element} activedTarget
   */
  iconClickHandler(activedTarget) {
    if (!activedTarget) {
      logger.debug('iconClickHandler::return;>>>>>>>>>>>>>>>>', this, activedTarget);
      return;
    }

    logger.debug(
      'iconClickHandler::return;>>>>>>>>>>>>>>>>',
      JSON.stringify(activedTarget.getBoundingClientRect())
    );
    const activedDomRect = activedTarget.getBoundingClientRect();
    const activedValtState = this.getValtState(activedTarget);

    const paramState = this._comboParams(activedTarget);
    const ifrSizeState = ifrSizeCalcWhenValtChanged(paramState);

    const { elemType, iHeight, tag } = ifrSizeState;

    const drawMessageData = {
      ...activedValtState,
      atHref: window.location.href,
      isInner: window.self !== window.top,
      levelNum: this.getLevelNum(),
      position: JSON.parse(JSON.stringify(activedDomRect)), //firefox domRect permission
      ifrHeight: iHeight,
    };

    this._sendMessageToTop(API_WIN_SELECTOR_DRAWER, drawMessageData);
  }

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
   * actived the first Position chain message
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

    const domRect = activedTarget.getBoundingClientRect();
    const transportMsg = {
      posterId: this.getId(),
      extid: this.extid,
      nodeRootHref: window.location.href,
      domRects: [
        {
          uuid: this.getId(),
          domRect,
          iframeSrc: window.location.href,
          activedField: activedTarget === this.targetUsername ? 'username' : 'password',
        },
      ],
    };
    logger.debug('actived the first Position chain message*****>>>', transportMsg, activedTarget);
    window.parent.postMessage(transportMsg, '*');
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

      //TODO send valtState to background

      // enabled:input:valtChanged event
      ctx.emit('enabled:input:valtChanged', e.target);

      drawBPassButtonRoot.call(ctx, e);

      /** 判断如何弹框和弹框高度 */
      const paramState = ctx._comboParams(e.target);
      const ifrSizeState = ifrSizeCalcWhenValtChanged(paramState);

      const { elemType, iHeight, tag } = ifrSizeState;
      const activedDomRect = e.target.getBoundingClientRect();

      logger.debug('FieldController::bindingActivedFocusEvents@focusin-->>', tag, elemType);
      if (elemType === 'drawing') {
        const drawMessageData = {
          ...activedValtState,
          isInner: window.self !== window.top,
          position: activedDomRect,
          iHeight,
        };

        ctx._sendMessageToTop(API_WIN_SELECTOR_DRAWER, drawMessageData);
      } else {
        /** do nothing. */
      }

      if (e.target === ctx.targetPassword) {
      } else if (e.target === ctx.targetUsername) {
      }
    });

    elem.addEventListener('focusout', (e) => {
      ctx.setActivedTarget(null);

      //TODO disabled:input:valtChanged
      ctx.emit('disabled:input:valtChanged', e.target);

      // document.querySelector(BPASS_BUTTON_TAG) && document.querySelector(BPASS_BUTTON_TAG).remove();

      //TODO send selector
    });
  }
}

function drawBPassButtonRoot(e) {
  let domRect = e.target.getBoundingClientRect();
  domRect = JSON.parse(JSON.stringify(domRect));

  logger.debug('drawBPassButtonRoot>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>', domRect);

  // logger.debug(
  //   'drawBPassButtonRoot>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>',
  //   window.customElements.get(BPASS_BUTTON_TAG)
  // );
  /** window pointer to target window */
  if (!window.customElements.get(BPASS_BUTTON_TAG)) {
    try {
      window.customElements.define(BPASS_BUTTON_TAG, BpassButton);
    } catch (error) {
      logger.warn('drawBPassButtonRoot>>>>>>>>>>>>>>', error.message);
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
