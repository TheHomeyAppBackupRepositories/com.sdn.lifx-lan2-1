'use strict';

const FileSystem = require('fs');
const Log = require('../lib/console_logger');
const EventEmitter = require('events');
const LIFX_EnergyData = require('../lib/lifxPowerConstants');
const LIFX_DevicesIndex = require('../products/products.json');
const LIFX_Device = require('../lib/lifx_device');
const LIFX_Client = require('lifx-lan-client').Client;
// For advanced effects
const LIFX_Packets = require('lifx-lan-client').packet;
const LIFX_Constants = require('lifx-lan-client').constants;
const LIFX_Utilities = require('lifx-lan-client').utils;
// For custom effects
const LIFX_Effects = require('../lib/lifx_effects');

/*
  Emits Events:
    - new_device (LIFX_Device)
    - device_offline (LIFX_Device)
    - device_online (LIFX_Device)

  Public Methods:
    - void          Activate()                      Activates the manager. Call this after subscribing all events.
    - object        GetEnergyInfo()                 Returns Energy Object or null.
    - LIFX_Device   GetDeviceById(string)           Returns an LIFX_Device or null for given id.
    - number        MapScale(numbers..)             Returns a scale mapped value.
    - int           GetWifiStrength(LIFX_Device)    Retuns strength as 0 to 5.
    - number        GetRandomNumber(min, max, hasDecimals)
    - HSB Object    GetRandomColorDataset (hueMin, hueMax, satMin, satMax, dimMin, dimMax, durMin, durMax)

    Public Fields/Properties:
    - [get|set] OperationMode             = string  OnOff & Dim, Debounce behaviour: Legacy|LIFX|Athom - Default: LIFX
    - [get|set] DebounceTime              = int     Device update command debounce time in milliseconds for related capabilities. Default: 50
    - [get]     Ready                     = bool    Whether the manager is ready.
    - [get]     DevicesWithoutIconsFound  = bool    Whether devices without icon been detected.
    - [get|set] PollingInterval           = int     Status polling interval.
    - [get|set] DefaultTransitionDuration = int     Default transition time in milliseconds.
    - [get]     KnownDevices              = array   Array of LIFX_Device objects.
*/

class LIFX_Manager extends EventEmitter {

  GetEnergyInfo(vId, pId) {
    if (LIFX_EnergyData.ENERGY_DATA[vId][pId]) {
      if (LIFX_EnergyData.ENERGY_DATA[vId][pId].usageOn) {
        return LIFX_EnergyData.ENERGY_DATA[vId][pId];
      }
    }
  }

  get LogErrors() {
    return this.Log.LogErrors;
  }
  set LogErrors(value) {
    this.Log.LogErrors = value;
  }

  async __countError(label) {
    var now = new Date();
    this.__errorRate[label].push(now);
    this.__sanitizeErrorRateRecords(label);
  }
  async __sanitizeErrorRateRecords(label) {
    var now = new Date();
    while (true) {
      if (this.__errorRate[label].length == 0) break;
      if (new Date(this.__errorRate[label][0].getTime() + (1000 * 60)) < now) {
        this.__errorRate[label].shift();
      } else {
        break;
      }
    }
  }

  async GetErrorRate(label) {
    await this.__sanitizeErrorRateRecords(label);
    return this.__errorRate[label].length;
  }

  constructor() {
    super();
    this.Log = new Log('LIFX Manager');
    this.Log.Log('Instancing..');
    this.__errorRate = {
      getState: [],
      getWifiInfo: [],
      getColorZones: [],
      colorZones: [],
      color: [],
      onoff: [],
      getRelayPower: []
    };
    this.Ready = false;
    this.IconsFolderLocation = '';
    this.LogErrors = false;
    this.KnownDevices = [];
    this.DevicesWithoutIconsFound = false;
    this.PollingInterval = 10000;
    this.DefaultTransitionDuration = 500;
    this.OperationMode = 'LIFX'; // Legacy|LIFX|Athom
    this.KelvinMode = 'LIFX'; // LIFX|ADOBE|IGNORE
    this.DebounceTime = 50;
    // Advanced effects
    this.Effects = new LIFX_Effects();
    // Device index list generation if in debug mode
    if (process) {
      if (process.env) {
        if (process.env.DEBUG) {
          if (process.env.DEBUG === '1') {
            console.log('-----------------< DEVICE INDEX >-------------------');
            var knownDeviceNamesList = [];
            LIFX_DevicesIndex.forEach((vendor, vIdx) => {
              vendor.products.forEach((product, pIdx) => {
                if (knownDeviceNamesList.includes(product.name) === false) knownDeviceNamesList.push(product.name);
              });
            });
            knownDeviceNamesList.sort();
            for (var pnIdx = 0; pnIdx < knownDeviceNamesList.length; pnIdx++) {
              console.log(knownDeviceNamesList[pnIdx]);
            }
            console.log('--------------< INSTALLED EFFECTS >-----------------');
            var effectList = this.Effects.GetInstalledEffectsFiles();
            effectList.forEach((effectFile, pIdx) => {
              console.log(effectFile);
            });
            console.log('----------------------------------------------------');
          }
        }
      }
    }
    // Run device index check
    LIFX_DevicesIndex.forEach((vendor, vIdx) => {
      this.Log.Log('Checking energy data for devices from Vendor ID: ', vendor.vid, ' Named: ', vendor.name);
      vendor.products.forEach((product, pIdx) => {
        var energyData = this.GetEnergyInfo(vendor.vid, product.pid);
        if (energyData === null || energyData === undefined) {
          this.Log.Warn('No energy data available for device: ', product.pid, ' Named: ', product.name);
        }
      });
    });
    this.Log.Log('Instanced.');
  }

  GetDeviceById(id) {
    let foundDevice = null;
    for (var i = 0; i < this.KnownDevices.length; i++) {
      if (this.KnownDevices[i].__device.id == id) {
        foundDevice = this.KnownDevices[i];
        break;
      }
    }
    return foundDevice;
  }

  Activate() {
    this.Log.Log('Activating..');
    let manager = this;
    LIFX_DevicesIndex.forEach((vendor, vIdx) => {
      this.Log.Log('Checking icons availability for devices from Vendor ID: ', vendor.vid, ' Named: ', vendor.name);
      vendor.products.forEach((product, pIdx) => {
        if (!FileSystem.existsSync(`${manager.IconsFolderLocation}${vendor.vid}_${product.pid}.svg`)) {
          this.Log.Warn('No icon available for device: ', product.pid, ' Named: ', product.name);
        }
      });
    });
    this.Client = new LIFX_Client();
    this.Client.on('error', function (err) {
      manager.Log.Error('Client Error: ', err);
      manager.Ready = false;
      manager.Client.destroy();
    });
    this.Client.on('light-new', function (light) {
      // Make sure there are no dublicates!
      manager.Log.Log('Discovered: ', light.id);
      let knownDevice = manager.GetDeviceById(light.id);
      if (knownDevice === null) {
        manager.Log.Log('Found new device: ', light.id);
        let newDevice = new LIFX_Device(light, manager);
        newDevice.LogErrors = manager.LogErrors;
        manager.KnownDevices.push(newDevice);
        manager.emit('new_device', newDevice);
      }
    });
    this.Client.on('light-offline', function (light) {
      manager.Log.Warn('Device went offline: ', light.id)
      let myDevice = manager.GetDeviceById(light.id);
      if (myDevice !== null) {
        myDevice.Online = false;
        manager.emit('device_offline', myDevice);
      }
    });
    this.Client.on('light-online', function (light) {
      manager.Log.Log('Device came back online: ', light.id)
      let myDevice = manager.GetDeviceById(light.id);
      if (myDevice !== null) {
        myDevice.Online = true;
        manager.emit('device_online', myDevice);
      }
    });
    this.Client.init({
      lightOfflineTolerance: 10,
      messageHandlerTimeout: 5000,
      startDiscovery: true,
      resendPacketDelay: 100,
      resendMaxTimes: 10, //TODO: Restest under stress
      debug: false
    });
    this.Ready = true;
    this.Log.Log('Activated.');
  }

  /**
   * Creates a color object from RGB code.
   * @param {string} hexCode RGB hex code.
   * @param {boolean} rawHsb Set true to get the raw hasb object instead of a processed hsbk object.
   * @returns {Color_Object} LIFX color object. 
   */
  __getColorObjectFromHex(hexCode, rawHsb) {
    var rgbObj = LIFX_Utilities.rgbHexStringToObject(hexCode);
    var hsbObj = LIFX_Utilities.rgbToHsb(rgbObj);
    if (rawHsb && rawHsb === true) {
      return { hue: hsbObj.h, saturation: hsbObj.s, brightness: hsbObj.b, kelvin: 3500 };
    }
    var hue = Math.round(hsbObj.h / LIFX_Constants.HSBK_MAXIMUM_HUE * 65535);
    var saturation = Math.round(hsbObj.s / LIFX_Constants.HSBK_MAXIMUM_SATURATION * 65535);
    var brightness = Math.round(hsbObj.b / LIFX_Constants.HSBK_MAXIMUM_BRIGHTNESS * 65535);
    return { hue: hue, saturation: saturation, brightness: brightness, kelvin: 3500 };
  }

  /**
   * 
   * @param {LIFX_Device} lifx_device Target LIFX Device
   * @param {number} start_index Start zone index.
   * @param {number} end_index End zone index.
   * @param {number} hue Hue.
   * @param {number} saturation Saturation. 
   * @param {number} brightness Brightness.
   * @param {number} kelvin Kelvin.
   * @param {number} duration Duration.
   * @param {boolean} apply Whether to apply any pending zone changes.
   */
  API_SetMultiZone(lifx_device, start_index, end_index, hue, saturation, brightness, kelvin, duration, apply) {
    this.Log.Log('API_SetMultiZone(', lifx_device.Name, ' Start At: ', start_index, ' End At: ', end_index, ' Hue: ', hue, ' Sat: ', saturation, ' Dim: ', brightness, ' Dur: ', duration, ' Apply: ', apply, ')');
    let manager = this;
    try {
      lifx_device.__device.colorZones(start_index, end_index, hue, saturation, brightness, kelvin, duration, apply, function (err) {
        if (err) {
          manager.__countError('colorZones');
          manager.Log.Error(lifx_device.Name, ' API_SetMultiZone: ', err);
        }
      });
    }
    catch (err) {
      if (err) {
        manager.__countError('colorZones');
        manager.Log.Error(lifx_device.Name, ' API_SetMultiZone: ', err);
      }
    }
  }

  /**
   * Create waveform effect packet.
   * @param {string|HW_ColorObj} color RGB hex code or hardware color object.
   * @param {int} effect_length Effect length.
   * @param {int} repeats Number of effect repeats.
   * @param {string} effect_mode Effect mode: SAW, SINE, HALF_SINE, TRIANGLE, PULSE
   * @param {number} skew_ratio Effect turnpoint as percentage.
   * @param {boolean} is_transient Whether the color is reset to the original after the effect ends.
   * @returns {LIFX_Packet} LIFX command object.
   */
  API_CreateWaveFormPacket(color, effect_length, repeats, effect_mode, skew_ratio, is_transient) {
    var colorData = null;
    if (typeof color == "string") {
      colorData = this.__getColorObjectFromHex(color);
    } else {
      colorData = color;
    }
    // { hue: 4733, saturation: 51117, brightness: 25559, kelvin: 3500 }
    const packetObj = LIFX_Packets.create('setWaveform', {
      isTransient: is_transient,
      color: colorData,
      period: effect_length,
      cycles: repeats,
      skewRatio: skew_ratio,
      waveform: (isNaN(effect_mode)) ? LIFX_Constants.LIGHT_WAVEFORMS.indexOf(effect_mode) : effect_mode
    }, this.Client.source);
    return packetObj;
  }
  /**
   * Creates a color object for hardware level functions.
   * @param {number} hue Hue in range of 0-360.
   * @param {number} sat Saturation in range of 0-100.
   * @param {number} dim Brightness in range of 0-100.
   * @param {number} kel Kelvin as percentage 0.0-1.0.
   * @param {LIFX_Device} forDevice LIFX_Device required for reference to the kelvin range.
   * @returns {HW_ColorObject} A hardware color object suitable for calles like setWaveform.
   */
  API_CreateHardwareColorObject(hue, sat, dim, kel, forDevice) {
    var colObj = {
      hue: this.MapScale(0, 360, 0, 65535, hue),
      saturation: this.MapScale(0, 100, 0, 65535, sat),
      brightness: this.MapScale(0, 100, 0, 65535, dim),
      kelvin: this.MapScale(0, 1, forDevice.TemperatureRange.Min, forDevice.TemperatureRange.Max, kel)
    }
    return colObj;
  }

  /**
   * Creates a multizone device hardware effect packet.
   * @param {string} effect Effect: MOVE, OFF
   * @param {string} direction Direction: TOWARDS, AWAY
   * @param {number} speed Effect speed.
   */
  API_CreateMultizoneEffectPacket(effect, direction, speed) {
    const packetObj = LIFX_Packets.create('setMultiZoneEffect', {
      effectType: LIFX_Constants.MULTIZONE_EFFECTS.indexOf(effect),
      speed: speed,
      parameter2: LIFX_Constants.MULTIZONE_EFFECTS_MOVE_DIRECTION.indexOf(direction)
    }, this.Client.source);
    return packetObj;
  }

  /**
   * Creates a packet to stop multizone device hardware effect.
   */
  API_CreateMultizoneEffectStopPacket() {
    const packetObj = LIFX_Packets.create('setMultiZoneEffect', {
      effectType: LIFX_Constants.MULTIZONE_EFFECTS.indexOf('OFF'),
      speed: 0
    }, this.Client.source);
    return packetObj;
  }

  async API_GetLastHevCycleResult(lifx_device) {
    // Get last hev cycle result..
    lifx_device.__device.getLastHevCycleResult(async function (err, data) {
      if (err) {
        lifx_device.Log.Error('getLastHevCycleResult: ', err);
      }
      if (data != null) {
        lifx_device.Status.hev.last_result = data;
        lifx_device.emit('status_hev_result', lifx_device.Status.hev.last_result);
      }
    });
  }

  /**
   * Sets the hev cycle 
   * @param {object} LIFX_Device
   * @param {boolean} toggle On/Off
   * @param {number} duration Optional duration of the cycle.
   */
  async API_SetHevCycle(currentDevice, toggle, duration) {
    if (duration === undefined) duration = 0;
    currentDevice.__device.setHevCycle(toggle, duration, async function (err, data) {
      if (err) {
        currentDevice.Log.Error('setHevCycle: ', err);
      }
      if (data != null) {
        currentDevice.Status.hev.duration_current = data.duration;
        currentDevice.Status.hev.duration_remaining = data.remaining;
        if (data.remaining > 0) {
          if (currentDevice.Status.hev.toggle === false) {
            currentDevice.Status.hev.toggle = true;
            currentDevice.emit('hev_cycle', true);
            // Get last hev cycle result..
            currentDevice.Manager.API_GetLastHevCycleResult(currentDevice);
          } else if (currentDevice.Status.hev.toggle === true) {
            currentDevice.Status.hev.toggle = false;
            currentDevice.emit('hev_cycle', false);
            // Get last hev cycle result..
            currentDevice.Manager.API_GetLastHevCycleResult(currentDevice);
          }
        }
        currentDevice.emit('status_hev_cycle', { remaining: currentDevice.Status.hev.duration_remaining, duration: currentDevice.Status.hev.duration_current });
      }
    });
  }

  /**
   * Controls a LIFX Switch relay.
   * @param {LIFX_Device} lifx_device The LIFX_Switch as LIFX_Device.
   * @param {number} relay_index Index of the relay starting at 0.
   * @param {number} relay_level Range 0 - 65535.
   */
  async API_ToggleRelay(lifx_device, relay_index, relay_level) {
    const packetObj = LIFX_Packets.create('setRelayPower', {
      relayIndex: relay_index,
      relayLevel: relay_level
    }, this.Client.source);
    this.API_SendCommandPacket(lifx_device, packetObj);
  }

  /**
   * Gets the status of an LIFX Switch relay.
   * @param {number} relay_index Index of the relay starting at 0.
   * @param {callback} callback Function to call after request has completed.
   */
  async API_GetRelayState(relay_index, callback) {
    const packetObj = LIFX_Packets.create('getRelayPower', {
      relayIndex: relay_index
    }, this.Client.source);
    var sqnNumber = this.client.send(packetObj);
    this.client.addMessageHandler('stateRelayPower', function (err, msg) {
      if (err) {
        return callback(err, null);
      }
      callback(null, {
        relay_index: msg.relayIndex,
        relay_level: msg.relayLevel
      });
    }, sqnNumber);
  }

  /**
   * Sends a LIFX command packet to a LIFX device.
   * @param {LIFX_Device} lifx_device Target device. 
   * @param {LIFX_Packet} lifx_packet Command package to send.
   */
  async API_SendCommandPacket(lifx_device, lifx_packet, retry_count) {
    lifx_packet.target = lifx_device.DeviceID;
    let manager = this;
    if (retry_count === undefined) {
      retry_count = 0;
    }
    if (retry_count > 0) {
      manager.Log.Warn(lifx_device.Name, lifx_packet, ' API_SendCommandPacket->Client is retrying:', retry_count);
    }
    try {
      this.Client.send(lifx_packet, function (err) {
        if (err) {
          manager.Log.Error(lifx_device.Name, lifx_packet, ' API_SendCommandPacket->Client.send:', err);
          // Resend while device is online
          if (lifx_device.Online === true) manager.API_SendCommandPacket(lifx_device, lifx_packet, retry_count++);
        }
      });
    }
    catch (err) {
      if (err) {
        manager.Log.Error(lifx_device.Name, lifx_packet, ' API_SendCommandPacket->Client.send:', err);
        // Resend while device is online
        if (lifx_device.Online === true) manager.API_SendCommandPacket(lifx_device, lifx_packet, retry_count++);
      }
    }
  }

  MapScale(input_scale_start, input_scale_end, output_scale_start, output_scale_end, value) {
    return output_scale_start + ((output_scale_end - output_scale_start) / (input_scale_end - input_scale_start)) * (value - input_scale_start);
  }

  GetRandomNumber(min, max, hasDecimals) {
    if (hasDecimals === true) {
      return Math.round(((Math.random() * (max - min)) + min) * 100) / 100
    } else {
      return (Math.random() * (max - min)) + min;
    }
  }

  GetRandomColorDataset(hueMin, hueMax, satMin, satMax, dimMin, dimMax, durMin, durMax) {
    if (!durMax) durMax = this.DefaultTransitionDuration;
    if (!durMin) durMin = this.DefaultTransitionDuration;
    // Sanitize hue
    if (!hueMin) hueMin = 0;
    if (!hueMax) hueMax = 0;
    if (hueMin < 0) hueMin = 0;
    if (hueMin > 360) hueMin = 360
    if (hueMax < 0) hueMax = 0;
    if (hueMax > 360) hueMax = 360
    if (hueMax < hueMin) hueMax = hueMin;
    // Sanitize sat
    if (!satMin) satMin = 0;
    if (!satMax) satMax = 0;
    if (satMin < 0) satMin = 0;
    if (satMin > 100) satMin = 100
    if (satMax < 0) satMax = 0;
    if (satMax > 100) satMax = 100
    if (satMax < satMin) satMax = satMin;
    // Sanitize dim
    if (!dimMin) dimMin = 0;
    if (!dimMax) dimMax = 0;
    if (dimMin < 0) dimMin = 0;
    if (dimMin > 100) dimMin = 100
    if (dimMax < 0) dimMax = 0;
    if (dimMax > 100) dimMax = 100
    if (dimMax < dimMin) dimMax = dimMin;
    // generate dataset
    let dataSet = {
      hue: this.GetRandomNumber(hueMin, hueMax, false),
      sat: this.GetRandomNumber(satMin, satMax, false),
      dim: this.GetRandomNumber(dimMin, dimMax, false),
      dur: this.GetRandomNumber(durMin, durMax, false)
    }
    return dataSet;
  }

  /**
   * @param {LIFX_Device} current_device The LIFX Device to get the data for.
   * @returns {number} WiFi strength as scale form 0 to 4.
   */
  GetWifiStrength(current_device) {
    var signal = current_device.Status.Wifi.signal;
    var val = Math.floor(10 * Math.log10(signal) + 0.5)
    if (val < 0 || val == 200) {
      // The value is wifi rssi
      if (val == 200) {
        return 0; // Which is silly because how would we get this value if the device is not connected :D
      } else if (val <= -80) {
        return 1;
      } else if (val <= -70) {
        return 2;
      } else if (val < -60) {
        return 3;
      } else {
        return 4;
      }
    } else {
      // The value is signal to noise ratio
      if (val == 4 || val == 5) {
        return 1;
      } else if (val >= 7 && val <= 11) {
        return 2;
      } else if (val >= 12 && val <= 16) {
        return 3;
      } else if (val > 16) {
        return 4;
      } else {
        return 0; // Which is silly because how would we get this value if the device is not connected :D
      }
    }
  }

  async __pollDeviceUpdate(currentDevice) {
    // Disable polling for unsupported device..
    if (currentDevice.Unsupported === true) {
      currentDevice.Log.Warn('Disabling status polling for unsupported device..');
      clearInterval(currentDevice.__devicePolling);
      currentDevice.__devicePolling = null;
    }
    // Execute poll only if the device is known to be online..
    if (currentDevice.__online === true) {
      // Poll for hardware identification..
      if (currentDevice.Status.Firmware.majorVersion != null && currentDevice.VendorId == 0) {
        currentDevice.__device.getHardwareVersion(async function (err, data) {
          if (err) {
            currentDevice.Log.Error('getHardwareVersion: ', err);
          }
          if (data != null) {
            currentDevice.VendorId = data.vendorId;
            currentDevice.ProductId = data.productId;
            currentDevice.HardwareVersion = data.version;
          } else {
            return;
          }
          // return can be null here
          var productInfo = currentDevice.__getProductData(currentDevice.VendorId, currentDevice.ProductId, currentDevice.Status.Firmware.majorVersion, currentDevice.Status.Firmware.minorVersion);
          if (productInfo != null) {
            currentDevice.ProductName = productInfo.name;
            currentDevice.VendorName = productInfo.vendorName;
            if (productInfo.features.color) currentDevice.SupportsColor = productInfo.features.color;
            if (productInfo.features.chain) currentDevice.SupportsChain = productInfo.features.chain;
            if (productInfo.features.matrix) currentDevice.SupportsMatrix = productInfo.features.matrix;
            if (productInfo.features.infrared) currentDevice.SupportsInfrared = productInfo.features.infrared;
            if (productInfo.features.multizone) currentDevice.SupportsMultizone = productInfo.features.multizone;
            if (productInfo.features.hev) currentDevice.SupportsHev = productInfo.features.hev;
            if (productInfo.features.relays) currentDevice.SupportsRelays = productInfo.features.relays;
            // Get number of relays
            if (currentDevice.SupportsRelays === true) {
              var sInfo = currentDevice.__getSwitchInfo(currentDevice.VendorId, currentDevice.ProductId);
              if (sInfo != null) {
                currentDevice.Status.relaysCount = sInfo.relays;
              }
            }
            if (productInfo.features.buttons) currentDevice.SupportsButtons = productInfo.features.buttons;
            // Get number of buttons
            if (currentDevice.SupportsButtons === true) {
              var sInfo = currentDevice.__getSwitchInfo(currentDevice.VendorId, currentDevice.ProductId);
              if (sInfo != null) {
                currentDevice.Status.buttonsCount = sInfo.buttons;
              }
            }
            if (productInfo.features.temperature_range) {
              if (productInfo.features.temperature_range[0] != productInfo.features.temperature_range[1]) {
                currentDevice.TemperatureRange.Min = productInfo.features.temperature_range[0];
                currentDevice.TemperatureRange.Max = productInfo.features.temperature_range[1];
                currentDevice.SupportsTemperature = true;
              }
            }
          } else {
            currentDevice.Unsupported = true;
            currentDevice.Log.Warn('Unsupported Device: Vendor: ', currentDevice.VendorId, ' Product: ', currentDevice.ProductId);
            currentDevice.emit('unsupported', currentDevice);
          }
          var eneryData = currentDevice.__getEnergyInfo(currentDevice.VendorId, currentDevice.ProductId)
          if (eneryData != null) {
            currentDevice.EnergyData = eneryData;
            currentDevice.emit('new_energy_settings', eneryData);
            currentDevice.Log.Log('Found energy data: Vendor: ', currentDevice.VendorId, ' Product: ', currentDevice.ProductId, ' Usage Min: ', currentDevice.EnergyData.usageOff, ' Usage Max: ', currentDevice.EnergyData.usageOn);
          } else {
            currentDevice.Log.Warn('No energy data available: Vendor: ', currentDevice.VendorId, ' Product: ', currentDevice.ProductId);
          }
        });
      } // End hardware data init
      if (currentDevice.Status.Firmware.majorVersion == null) {
        currentDevice.__device.getFirmwareVersion(async function (err, data) {
          if (err) {
            currentDevice.Log.Error('getFirmwareVersion: ', err);
          }
          if (data != null) {
            currentDevice.Log.Log('getFirmwareVersion: ', data);
            currentDevice.Status.Firmware = data;
            currentDevice.emit('new_firmware_info', currentDevice);
          }
        });
      }
      // Get name if we know none
      if (currentDevice.Status.name == '?') {
        currentDevice.__device.getLabel(async function (err, data) {
          if (err) {
            currentDevice.Log.Error('getLabel: Failed getting update!');
          }
          if (data != null) {
            currentDevice.Status.name = data;
          }
        }, false);
      }
      if (currentDevice.Ready === false && currentDevice.Status.Init.hwData === false) {
        if (currentDevice.Status.name != '?' && currentDevice.VendorId > 0 && currentDevice.Unsupported !== true && currentDevice.Status.Firmware.majorVersion != null) {
          currentDevice.Log.Log('Device Ready: ', currentDevice.ProductName, ' as ', currentDevice.Status.name);
          currentDevice.Status.Init.hwData = true;
        }
      }
      // Do all the stuff done if a device is online..
      // updateDevice_wifiInfo
      currentDevice.Status.Wifi.rescan_timeout--;
      // Wifi data scanning is only done every few cycles to reduce network traffic.
      if (currentDevice.Status.Wifi.rescan_timeout == 0) {
        currentDevice.Status.Wifi.rescan_timeout = 5;
        currentDevice.__device.getWifiInfo(async function (err, data) {
          if (err) {
            currentDevice.Manager.__countError('getWifiInfo');
            currentDevice.Log.Error('getWifiInfo: Failed getting wifi info update!');
          }
          if (data != null) {
            currentDevice.Status.Wifi.rx = data.rx;
            currentDevice.Status.Wifi.tx = data.tx;
            currentDevice.Status.Wifi.signal = data.signal;
            currentDevice.emit('new_wifi_info', currentDevice);
          }
        });
      }
      // updateDevice_wifiData
      if (currentDevice.Status.Wifi.Firmware.majorVersion == 0 && currentDevice.Status.Wifi.Firmware.minorVersion == 0 && currentDevice.Status.Wifi.FirmwareInfoRead === false) {
        currentDevice.__device.getWifiVersion(async function (err, data) {
          if (err) {
            currentDevice.Log.Error('getWifiVersion: ', err);
          }
          if (data != null) {
            currentDevice.Log.Log('Got wifi version info for ', currentDevice.Name, ': ', data);
            currentDevice.Status.Wifi.Firmware = data;
            currentDevice.Status.Wifi.FirmwareInfoRead = true;
            currentDevice.emit('new_wifi_firmware_info', currentDevice);
          }
        });
      }
      // Do all the stuff done if a device is online and ready..
      if (currentDevice.Status.Init.hwData == true) {
        // updateDevice_multizoneInfo - poll only for zonesCount
        if (currentDevice.SupportsMultizone === true && currentDevice.Status.zonesData == null) {
          currentDevice.__device.getColorZones(0, 255, async function (err, data) {
            if (err) {
              currentDevice.Manager.__countError('getColorZones');
              currentDevice.Log.Error('getColorZones: Failed getting update!');
            }
            if (data != null) {
              //currentDevice.Status.zonesData = data; // This is unused
              currentDevice.Status.zonesData = true; // Remember we updated.
              currentDevice.ZonesCount = data.count;
              currentDevice.emit('new_zones_data', currentDevice);
            }
          });
        }
        // Update hev information
        if (currentDevice.SupportsHev === true) {
          // Get current hev cycle state..
          currentDevice.__device.getHevCycle(async function (err, data) {
            if (err) {
              currentDevice.Log.Error('getHevCycle: ', err);
            }
            if (data != null) {
              currentDevice.Status.hev.duration_current = data.duration;
              currentDevice.Status.hev.duration_remaining = data.remaining;
              if (data.remaining > 0 && currentDevice.Status.hev.toggle === false) {
                currentDevice.Status.hev.toggle = true;
                currentDevice.emit('hev_cycle', true);
              } else if (data.remaining == 0 && currentDevice.Status.hev.toggle === true) {
                currentDevice.Status.hev.toggle = false;
                currentDevice.emit('hev_cycle', false);
              }
              currentDevice.emit('status_hev_cycle', { remaining: currentDevice.Status.hev.duration_remaining, duration: currentDevice.Status.hev.duration_current });
            }
          });
          // Get last hev cycle result..
          currentDevice.Manager.API_GetLastHevCycleResult(currentDevice);
          // Get hev cycle default configuration..
          currentDevice.__device.getHevCycleConfiguration(async function (err, data) {
            if (err) {
              currentDevice.Log.Error('getHevCycleConfiguration: ', err);
            }
            if (data != null) {
              currentDevice.Status.hev.duration_default = data.duration;
              currentDevice.emit('status_hev_config', currentDevice.Status.hev.duration_default);
            }
          });
        }
        // updateDevice_irStatus
        if (currentDevice.SupportsInfrared === true) {
          currentDevice.__device.getMaxIR(async function (err, data) {
            if (err) {
              currentDevice.Log.Error('getMaxIR: ', err);
            }
            if (data != null) {
              currentDevice.Status.infrared = data;
              currentDevice.emit('status_infrared', currentDevice.Status.infrared);
            }
          });
        }
        // Poll relays/buttons update & emit changes
        if (currentDevice.SupportsRelays === true) {
          // Poll relay updates instead of light status
          for (var rIdx = 0; rIdx < currentDevice.NumberOfRelays; rIdx++) {
            currentDevice.Manager.API_GetRelayState(rIdx, function (err, data) {
              if (err) {
                currentDevice.Manager.__countError('getRelayPower');
                currentDevice.Log.Error('API_GetRelayState: Failed getting update!');
              }
              if (data != null) {
                currentDevice.Status.relayStatus[data.relayIndex] = data.relayLevel;
                // Notify overall onOff state
                var oldOverAllStatus = currentDevice.OnOff;
                currentDevice.__updateOverallRelayStatus();
                if (oldOverAllStatus != currentDevice.OnOff) {
                  currentDevice.emit('new_relay_overall', currentDevice.OnOff);
                }
                currentDevice.emit('new_relay_level', data.relayIndex, currentDevice.Manager.MapScale(0, 65535, 0, 1, data.relayLevel));
              }
            });
          }
        } else {
          // updateDevice_status
          currentDevice.__device.getState(async function (err, data) {
            if (err) {
              currentDevice.Manager.__countError('getState');
              currentDevice.Log.Error('getState: Failed getting update!');
            }
            if (data != null) {
              if (currentDevice.Status.name != data.label) {
                currentDevice.Status.name = data.label;
                currentDevice.emit('new_name', data.label);
              }
              var chkDebounceData = currentDevice.__hasDebounceData();
              if (currentDevice.__inOnOffDebounce === 0 && chkDebounceData === false) {
                var turnedOn = (data.power === 1) ? true : false;
                if (currentDevice.Status.onoff != turnedOn) {
                  currentDevice.Status.onoff = turnedOn;
                  currentDevice.emit('status_onoff', turnedOn);
                }
              }
              if (currentDevice.__inColorDebounce === 0 && chkDebounceData === false) {
                var currentDim = data.color.brightness / 100;
                if (currentDevice.Status.dim != currentDim) {
                  currentDevice.Status.dim = currentDim;
                  currentDevice.emit('new_dim', currentDim);
                }
                if (currentDevice.SupportsTemperature === true) {
                  var currentTemp = currentDevice.Manager.MapScale(currentDevice.TemperatureRange.Max, currentDevice.TemperatureRange.Min, 0, 1, data.color.kelvin);
                  if (currentDevice.Status.temperature != currentTemp) {
                    if (currentTemp > 1 || currentTemp < 0) {
                      currentDevice.Log.Warn(currentDevice.Name, ' Received a faulty light temparature setting: ', currentTemp, ' Raw value was: ', data.color.kelvin);
                    } else {
                      currentDevice.Status.temperature = currentTemp;
                      // Update cached temp as well if we are in kelvin mode
                      if (currentDevice.Status.saturation == 0) currentDevice.Status.temperatureCached = currentTemp;
                      currentDevice.emit('new_temperature', currentTemp);
                    }
                  }
                }
                if (currentDevice.SupportsColor === true) {
                  var currentSat = data.color.saturation / 100;
                  if (currentDevice.Status.saturation != currentSat) {
                    if (currentDevice.ColorMode == false && currentSat > 0) {
                      currentDevice.emit('color_mode', true);
                    } else if (currentDevice.ColorMode == true && currentSat == 0) {
                      currentDevice.emit('color_mode', false);
                    }
                    currentDevice.Status.saturation = currentSat;
                    // Update cached sat as well
                    if (currentSat > 0.0) currentDevice.Status.saturationCached = currentSat;
                    currentDevice.emit('new_saturation', currentSat);
                  }
                  if (currentDevice.Status.color != data.color.hue) {
                    currentDevice.Status.color = data.color.hue;
                    currentDevice.emit('new_color', data.color.hue);
                  }
                }
              }
              if (currentDevice.Status.Init.lightData === false) currentDevice.Status.Init.lightData = true;
              if (currentDevice.Ready === false && currentDevice.Status.Init.hwData === true && currentDevice.Status.Init.lightData === true) {
                currentDevice.Ready = true;
              }
            } // got data
          }); // getState
        }
      } // hwData == true
    } // isOnline
  }

  /**
   * Processes pending updates for a LIFX Device.
   * @param {LIFX_Device} currentDevice Device to process updates for.
   */
  async __updateDeviceExecute(currentDevice) {
    // Configure update modes..
    var colorUpdate = false;
    var dimming = false;
    var onOffUpdate = false;
    // Additional update info for the update emitter only.
    var emitUpdInfo = {
      "color": false,
      "sat": false,
      "temp": false,
      "dim": false
    }
    if (currentDevice.FutureStatus.onoff != null) {
      onOffUpdate = true;
    }
    if (currentDevice.FutureStatus.dim != null) {
      colorUpdate = true;
      emitUpdInfo.dim = true;
      dimming = true;
    }
    if (currentDevice.FutureStatus.temperature != null) {
      colorUpdate = true;
      emitUpdInfo.temp = true;
    }
    if (currentDevice.FutureStatus.color != null) {
      colorUpdate = true;
      emitUpdInfo.color = true;
    }
    if (currentDevice.FutureStatus.saturation != null) {
      colorUpdate = true;
      emitUpdInfo.sat = true;
    }
    // Different mode logics
    if (currentDevice.Manager.OperationMode == 'Athom') {
      if (dimming == true) {
        if (currentDevice.OnOff == true && currentDevice.FutureStatus.dim == 0.00) {
          currentDevice.FutureStatus.onoff = false;
          onOffUpdate = true;
        } else if (currentDevice.OnOff == false && currentDevice.Status.dim == 0.00 && currentDevice.FutureStatus.dim > 0.00) {
          currentDevice.FutureStatus.onoff = true;
          onOffUpdate = true;
        }
      }
    }
    // Handle minimum dim level if needed..
    if (currentDevice.Manager.OperationMode == 'Athom' || currentDevice.Manager.OperationMode == 'LIFX') {
      if (onOffUpdate === true) {
        if (currentDevice.OnOff === true && currentDevice.Status.dim == 0.00) {
          currentDevice.FutureStatus.dim = 0.01;
          emitUpdInfo.dim = true;
          colorUpdate = true;
        }
      }
    }
    // Store current update data for backup measures
    let updateDataBackup = JSON.parse(JSON.stringify(currentDevice.FutureStatus));
    // Handle missing duration
    if (currentDevice.FutureStatus.duration == null) currentDevice.FutureStatus.duration = currentDevice.Manager.DefaultTransitionDuration;
    // Handle color mode updates
    if (colorUpdate === true) {
      // Fill data gaps..
      if (currentDevice.FutureStatus.dim == null) currentDevice.FutureStatus.dim = currentDevice.DimLevel;
      if (currentDevice.FutureStatus.temperature == null) currentDevice.FutureStatus.temperature = currentDevice.LightTemperature;
      if (currentDevice.FutureStatus.color == null) currentDevice.FutureStatus.color = currentDevice.LightColor;
      if (currentDevice.FutureStatus.saturation == null) currentDevice.FutureStatus.saturation = currentDevice.LightSaturation;
      // Convert data for device..
      currentDevice.__inColorDebounce++;
      // Emit update events
      if (emitUpdInfo.dim === true) currentDevice.emit('new_dim', currentDevice.FutureStatus.dim);
      if (emitUpdInfo.temp === true) currentDevice.emit('new_temperature', currentDevice.FutureStatus.temperature);
      if (emitUpdInfo.color === true) {
        currentDevice.emit('new_color', currentDevice.FutureStatus.color);
      }
      if (emitUpdInfo.sat === true) {
        currentDevice.emit('new_saturation', currentDevice.FutureStatus.saturation);
        if (currentDevice.FutureStatus.saturation > 0) {
          currentDevice.emit('color_mode', true);
        } else {
          currentDevice.emit('color_mode', false);
        }
      }
      // Add ability to control kelvin behavior when switching to color mode
      var newKelvin = currentDevice.Manager.MapScale(0.0, 1.0, currentDevice.TemperatureRange.Max, currentDevice.TemperatureRange.Min, currentDevice.FutureStatus.temperature);
      if (currentDevice.FutureStatus.saturation > 0.0) {
        if (currentDevice.Manager.KelvinMode == 'LIFX') {
          currentDevice.Log.Log(currentDevice.Name, " color(..) in Kelvin Mode: LIFX");
          newKelvin = 3500;
        } else if (currentDevice.Manager.KelvinMode == 'ADOBE') {
          currentDevice.Log.Log(currentDevice.Name, " color(..) in Kelvin Mode: ADOBE");
          newKelvin = 6504;
        } else {
          currentDevice.Log.Log(currentDevice.Name, " color(..) in Kelvin Mode: Advanced");
        }
      }
      currentDevice.Log.Log(currentDevice.Name, " color(Hue: ", currentDevice.FutureStatus.color, ', Sat: ', currentDevice.FutureStatus.saturation * 100, ', Dim: ', currentDevice.FutureStatus.dim * 100, ', Temp: ', newKelvin, ', Dur: ', currentDevice.FutureStatus.duration, ')');
      await currentDevice.__device.color(currentDevice.FutureStatus.color, currentDevice.FutureStatus.saturation * 100, currentDevice.FutureStatus.dim * 100, newKelvin, currentDevice.FutureStatus.duration, function (err) {
        if (err) {
          currentDevice.Manager.__countError('color');
          currentDevice.Log.Error(currentDevice.Name, ' color(hue): Updating device failed or timed out!');
          // Try spooling the update again..
          currentDevice.FutureStatus = updateDataBackup;
          currentDevice.__updateDevice();
        }
        currentDevice.__inColorDebounce--;
      });
      currentDevice.Status.dim = currentDevice.FutureStatus.dim;
      currentDevice.Status.temperature = currentDevice.FutureStatus.temperature;
      currentDevice.Status.color = currentDevice.FutureStatus.color;
      currentDevice.Status.saturation = currentDevice.FutureStatus.saturation;
    }
    // Handle onOff updates
    if (onOffUpdate === true) {
      if (currentDevice.FutureStatus.onoff === true) {
        currentDevice.Log.Log(currentDevice.Name, ' Turning on..');
        currentDevice.__inOnOffDebounce++;
        currentDevice.emit('status_onoff', true);
        await currentDevice.__device.on(currentDevice.FutureStatus.duration, function (err) {
          if (err) {
            currentDevice.Manager.__countError('onoff');
            currentDevice.Log.Error(currentDevice.Name, ' on: Updating device failed or timed out!');
            // Try spooling the update again..
            currentDevice.FutureStatus = updateDataBackup;
            currentDevice.__updateDevice();
          }
          currentDevice.__inOnOffDebounce--;
        });
        currentDevice.Status.onoff = currentDevice.FutureStatus.onoff;
      } else {
        currentDevice.Log.Log(currentDevice.Name, ' Turning off..');
        currentDevice.__inOnOffDebounce++;
        currentDevice.emit('status_onoff', false);
        await currentDevice.__device.off(currentDevice.FutureStatus.duration, function (err) {
          if (err) {
            currentDevice.Manager.__countError('onoff');
            currentDevice.Log.Error(currentDevice.Name, ' off: Updating device failed or timed out!');
            // Try spooling the update again..
            currentDevice.FutureStatus = updateDataBackup;
            currentDevice.__updateDevice();
          }
          currentDevice.__inOnOffDebounce--;
        });
        currentDevice.Status.onoff = currentDevice.FutureStatus.onoff;
      }
    }
    // Cleanup
    clearTimeout(currentDevice.__updateTimeout);
    currentDevice.__updateTimeout = null;
    currentDevice.__resetDebounceData();
  }

}

module.exports = LIFX_Manager;
