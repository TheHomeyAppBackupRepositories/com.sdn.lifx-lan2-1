'use strict';

const fetch = require('node-fetch');
const apiRootUrl = 'https://api.lifx.com/v1';

module.exports = class LIFX_CloudApi {

  constructor(homey) {
    this.homey = homey;
  }

  getToken() {
    let token = this.homey.app.cloudApiToken;
    if (token == null) throw new Error(this.homey.__('inAppErrors.cloudApiTokenNeeded'));
    return token;
  }

  async get(dataObject) {
    const myToken = this.getToken();
    const headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${myToken}`
    };
    const data = null;
    // make request
    let response;
    response = await fetch(`${apiRootUrl}${dataObject.path}`, { method: 'GET', headers: headers, body: data })
    let responseJson = await response.json();
    if (responseJson.error) {
      throw new Error(responseJson.error);
    }
    return responseJson;
  }

  async put(dataObject) {
    const myToken = this.getToken();
    const headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${myToken}`
    };
    const data = JSON.stringify(dataObject.json);
    // make request
    let response;
    response = await fetch(`${apiRootUrl}${dataObject.path}`, { method: 'PUT', headers: headers, body: data })
    let responseJson = await response.json();
    if (responseJson.error) {
      throw new Error(responseJson.error);
    }
    return responseJson;
  }

  async post(dataObject) {
    const myToken = this.getToken();
    const headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${myToken}`
    };
    const data = JSON.stringify(dataObject.json);
    // make request
    let response;
    response = await fetch(`${apiRootUrl}${dataObject.path}`, { method: 'POST', headers: headers, body: data })
    let responseJson = await response.json();
    if (responseJson.error) {
      throw new Error(responseJson.error);
    }
    return responseJson;
  }

  /*  async getLights({ selector = 'all' } = {}) {
      const lights = await this.get({
        path: `/lights/${selector}`,
      });
  
      if(!Array.isArray(lights))
        throw new Error(this.homey.__('invalidArray'));
  
      return lights;
    }
  
    async setState({ selector = 'all', state = {} } = {}) {
      return this.put({
        path: `/lights/${selector}/state`,
        json: {
          fast: true,
          ...state,
        }
      });
    }
  
    async setStates({ selector = 'all', states = [], defaults = {} }) {
      return this.put({
        path: `/lights/states`,
        json: {
          states,
          defaults,
        },
      });
    }*/

  async setEffectFlame({ device_id, period, power_on } = {}) {
    return this.post({
      path: `/lights/id:${device_id}/effects/flame`,
      json: {
        period: period,
        power_on: power_on
      }
    })
  }

  async setEffectMorph({ device_id, period, palette, power_on } = {}) {
    return this.post({
      path: `/lights/id:${device_id}/effects/morph`,
      json: {
        period: period,
        palette: palette,
        power_on: power_on
      }
    })
  }

  async stopChainDeviceEffect({ device_id, power_off } = {}) {
    return this.post({
      path: `/lights/id:${device_id}/effects/off`,
      json: {
        power_off: power_off
      }
    })
  }

  async getScenes() {
    return this.get({
      path: `/scenes`
    });
  }

  async setScene({ sceneUuid, ignoreList, duration } = {}) {
    return this.put({
      path: `/scenes/scene_id:${sceneUuid}/activate`,
      json: {
        duration: duration,
        ignore: ignoreList
      }
    })
  }

  async setSceneOverride({ sceneUuid, ignoreList, state, duration } = {}) {
    return this.put({
      path: `/scenes/scene_id:${sceneUuid}/activate`,
      json: {
        duration: duration,
        overrides: state,
        ignore: ignoreList
      }
    })
  }

}
