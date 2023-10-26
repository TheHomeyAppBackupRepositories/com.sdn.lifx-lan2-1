'use strict';

module.exports = {
  async getSettingsData({ homey, query, params, body }) {
    if (params.cmd == 'getDeviceList') {
      let devices = homey.app.getDevicesData();
      return Promise.resolve(devices);
    } else if (params.cmd == 'getRegStatus') {
      var regStatus = {
        RegEnabled: homey.app.AppRegistrationEnabled,
        Registered: await homey.app.getAppRegistered(),
        RegMail: homey.app.appRegEmail,
        RequestCode: await homey.app.getAppRegistrationRequestCode()
      };
      return Promise.resolve(regStatus);
    } else if (params.cmd == 'getErrorRates') {
      let errStats = {
        getState: await homey.app.LIFX_Manager.GetErrorRate('getState'),
        getWifiInfo: await homey.app.LIFX_Manager.GetErrorRate('getWifiInfo'),
        getColorZones: await homey.app.LIFX_Manager.GetErrorRate('getColorZones'),
        colorZones: await homey.app.LIFX_Manager.GetErrorRate('colorZones'),
        color: await homey.app.LIFX_Manager.GetErrorRate('color'),
        onoff: await homey.app.LIFX_Manager.GetErrorRate('onoff'),
        getRelayPower: await homey.app.LIFX_Manager.GetErrorRate('getRelayPower')
      }
      return Promise.resolve(errStats);
    }
  },
  async registration({ homey, query, params, body }) {
    if (params.cmd == 'registration') {
      var regStatus = await homey.app.getAppRegistered();
      if (regStatus != 0) {
        // If we get null the app is registered already!
        homey.settings.set('appRegEmail', body.regMail);
        homey.settings.set('appRegKey', body.regKey);
        regStatus = await homey.app.getAppRegistered();
      }
      return Promise.resolve({ 'regStatus': regStatus });
    }
  },
  async customEffects({ homey, query, params, body }) {
    homey.app.Log.Log('CE API CALL: ', params);
    if (body && body.authKey == homey.app.ceEditorKey) {
      let data = null;
      var regStatus = await homey.app.getAppRegistered();
      if (regStatus != 0) {
        data = { type: "ERROR", msg: homey.__('ceExtension.apiRespNotRegistered') };
      } else {
        if (params.ce == 'ceLoad') {
          data = {
            type: 'INIT',
            appver: homey.app.manifest.version,
            ceever: homey.app.CEEMaxVersion,
            lang: homey.app.getWebEditorLanguage(),
            devices: homey.app.getDevicesData(),
            effects: homey.app.__getCustomEffectsIndex()
          }
          if (body.skipInit && body.skipInit === true) {
            data.skipInit = true;
          }
        } else if (params.ce == 'ceLoadEffect') {
          if (body.clone) {
            data = homey.app.__getCustomEffect(body.ceid, true);
          } else {
            data = homey.app.__getCustomEffect(body.ceid);
          }
        } else if (params.ce == 'ceNewEffect') {
          data = homey.app.__createNewCustomEffect();
        } else if (params.ce == 'ceSaveEffect') {
          data = homey.app.__saveCustomEffect(body.ceid, body.ce);
        } else if (params.ce == 'ceDelEffect') {
          data = homey.app.__deleteCustomEffect(body.ceid);
        } else if (params.ce == 'cePlayEffect') {
          if (homey.app.__startCustomEffect(body.ceid) === true) {
            data = { type: "ACK" };
          } else {
            data = { type: "MSG", title: homey.__('ceExtension.apiRespEffectNotStarted'), msg: homey.__('ceExtension.apiRespEffectNotStartedInfo') };
          }
        } else if (params.ce == 'ceStopEffect') {
          homey.app.__stopCustomEffect(body.ceid);
          data = { type: "ACK" };
        }
      }
      homey.app.Log.Log('CE API RESPONSE: ', data);
      return Promise.resolve(data);
    } else {
      return Promise.reject(homey.__('ceExtension.badApiKey'));
    }
  }
};
