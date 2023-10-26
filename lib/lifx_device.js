'use strict';

const Log = require('../lib/console_logger');
const BinaryCutter = require('utf8-binary-cutter');
const EventEmitter = require('events');
const LIFX_EnergyData = require('../lib/lifxPowerConstants');
const LIFX_SwitchData = require('../lib/lifxSwitchConstants');
const LIFX_DevicesIndex = require('../products/products.json');

/*
  Emits Events:
    - device_online (LIFX_Device)
    - device_offline (LIFX_Device)
    - unsupported (LIFX_Device)
    - new_zones_count (int)
    - status_infrared (number)
    - status_onoff (bool)
    - new_name (string)
    - new_dim (percentage)
    - new_temperature (percentage)
    - new_saturation (percentage)
    - new_color (degrees_360)
    - color_mode (bool)
    - new_zones_data (LIFX_Device)
    - new_firmware_info (LIFX_Device)
    - new_wifi_firmware_info (LIFX_Device)
    - new_wifi_info (LIFX_Device)
    - new_energy_settings (energy data object)
    - new_relay_level (relay index, percentage)
    - new_relay_overall (OnOff as bool)
    - hev_cycle (OnOff as bool)
    - status_hev_result (last hev cycle result as number)
    - status_hev_cycle (duration and remaining data object in seconds as number)
    - status_hev_config (default cycle duration in seconds as number)

  Public Methods:
    - void    SetOnOff(bool, duration)                    Sets the device state over time in milliseconds.
    - void    SetDimLevel(percentage, duration)           Sets the device state over time in milliseconds.
    - void    SetLightTemperature(percentage, duration)   Sets the device state over time in milliseconds.
    - void    SetLightColor(degrees_360, duration)        Sets the device state over time in milliseconds.
    - void    SetLightColorByHex(hexCode, duration)       Sets the device state over time in milliseconds. This is a direct API call.
    - void    SetLightSaturation(percentage, duration)    Sets the device state over time in milliseconds.
    - void    SetRelayStatus(index, bool|percentage)      Sets the status the relay at index to state or percentage. 
    - void    GetRelayStatus(index)                       Gets the status the relay as percentage. 
    - number  GetRelayPowerConsumption(index)             Gets the power consumption caused by a relay by relay index.
    - void    SetAllRelays(index, bool|percentage)        Sets the status of all relays to state or percentage. 
    - void    SetHevActive(duration)                      Starts hev mode with given duration in seconds. 

  Public Fields/Properties:
    - [get]     DeviceID              = string      The devices actual hardware ID.
    - [get]     DeviceIP              = string      The devices actual IP.
    - [get]     Online                = bool        Whether the device is seen on the network.
    - [get]     Ready                 = bool        Whether the device has been initialized.
    - [get|set] Name                  = string      Setting the name will attempt to rename the physical device. Retuns '?' if unknown.
    - [get]     Manager               = object      Reference to the LIFX Manager instance.
    - [get]     Unsupported           = bool        Whether the device is supported or not.
    - [get]     VendorName            = string      The vendor name of the device if known. Returns '?' if unknown.
    - [get]     ProductName           = string      The product name of the device if known. Returns '?' if unknown.
    - [get]     HardwareVersion       = int         The hardware version of the product. Default: 0
    - [get]     FirmwareMajorVersion  = int         The firmware's major version. Default: 0
    - [get]     FirmwareMinorVersion  = int         The firmware's minor version. Default: 0
    - [get]     VendorId              = int         Id of the device vendor.
    - [get]     ProductId             = int         Id of the product.
    - [get]     EnergyData            = object      Contains min and max values for calculating the power consumption. Is null if unavailble.
    - [get]     EnergyData.usageOff   = double      Wattage when the device is in standby.
    - [get]     EnergyData.usageOn    = double      Wattage when the device is at max consumption.
    - [get]     TemperatureRange.Min  = int         Minimum Kelvin supported. Default: 3500
    - [get]     TemperatureRange.Max  = int         Maximum Kelvin supported. Default: 3500
    - [get]     ZonesCount            = int         Number of zones this device has.
    - [get]     NumberOfRelays        = number      Number of relays if supported.
    - [get]     NumberOfPulledRelays  = number      Number of relays switched on.
    - [get]     SwitchEnergyOverall   = number      Overall power consumption of the device.
    - [get]     SupportsColor         = bool        Whether the device supports colors.
    - [get]     SupportsChain         = bool        Whether the device supports chain features (eg. LIFX Tile).
    - [get]     SupportsMatrix        = bool        Whether the device supports matrix features (eg. Candle).
    - [get]     SupportsInfrared      = bool        Whether the device supports infrared.
    - [get]     SupportsMultizone     = bool        Whether the device supports zones (eg. LIFX BEAM, LIFX Z,..).
    - [get]     SupportsHev           = bool        Whether the device supports desinfectioning feature.
    - [get]     SupportsRelays        = bool        Whether the device has relais (eg. LIFX Switch).
    - [get]     SupportsButtons       = bool        Whether the device has buttons (eg. LIFX Switch).
    - [get]     SupportsTemperature   = bool        Whether the device supports white temperatures.
    - [get]     HevStatus             = number      Returns the last known hev status value.
    - [get]     HevRemaining          = number      Returns the remaining hev cycle time in seconds.
    - [get]     HevDefault            = number      Returns the default hev cycle time in seconds.
    - [get]     HevCurrent            = number      Returns the current hev cycle time in seconds.
    - [get|set] OnOff                 = bool        Get or sets the device state. For relays this toggles all relays. Can be a percentage for relays.
    - [get|set] Infrared              = number      Get or sets the device state. (0 - 100)
    - [get|set] DimLevel              = percentage  Get or sets the device state.
    - [get|set] LightTemperature      = percentage  Get or sets the device state.
    - [get|set] LightColor            = degrees_360 Get or sets the device state.
    - [get|set] LightSaturation       = percentage  Get or sets the device state.
    - [get|set] ColorMode             = bool        Get or sets the device state.
    - [get|set] HevActive             = bool        Get or sets the device's hev mode.

*/

class LIFX_Device extends EventEmitter {

  __getEnergyInfo(vId, pId) {
    if (LIFX_EnergyData.ENERGY_DATA[vId][pId]) {
      if (LIFX_EnergyData.ENERGY_DATA[vId][pId].usageOn) {
        return LIFX_EnergyData.ENERGY_DATA[vId][pId];
      }
    }
    return null;
  }

  __getSwitchInfo(vId, pId) {
    if (LIFX_SwitchData.SWITCH_DATA[vId][pId]) {
      return LIFX_SwitchData.SWITCH_DATA[vId][pId];
    }
    return null;
  }

  __getProductData(vId, pId, fwMa, fwMi) {
    var productData = null;
    var vendorName = '?';
    var fwVerStr = `${fwMa}.${fwMi}.0`;
    LIFX_DevicesIndex.forEach((vendor, vIdx) => {
      if (vendor.vid == vId) {
        vendorName = vendor.name;
        vendor.products.forEach((product, pIdx) => {
          if (product.pid == pId) {
            productData = JSON.parse(JSON.stringify(product));
            productData.vendorName = vendorName;
            //TODO: TEST: Process feature upgrades by firmware version
            if (product.upgrades) {
              product.upgrades.forEach(availableUpgrade => {
                var upgVerStr = `${availableUpgrade.major}.${availableUpgrade.minor}.0`;
                var upgradeValid = this.__versionSatisfiesMinimum(upgVerStr, fwVerStr);
                if (upgradeValid === true) {
                  Object.keys(availableUpgrade.features).forEach(function (key) {
                    productData.features[key] = availableUpgrade.features[key];
                  });
                }
              });
            }
          }
        });
      }
    });
    return productData;
  }

  get LogErrors() {
    return this.Log.LogErrors;
  }
  set LogErrors(value) {
    this.Log.LogErrors = value;
  }

  // Properties
  get DeviceID() {
    return this.__device.id;
  }

  get DeviceIP() {
    return this.__device.address;
  }

  get Name() {
    return this.Status.name;
  }
  set Name(new_name) {
    if (new_name == this.Status.name) return;
    this.Log.Log('Renaming device from ', this.Status.name, ' to ', new_name);
    // Check for valid new name
    if (typeof new_name === "string" && new_name !== '') {
      // Parse new label and truncate at 32 bytes
      this.Status.name = BinaryCutter.truncateToBinarySize(new_name, 32);
      // Set new label with a max of 32 bytes (LIFX limit)
      this.__device.setLabel(this.Status.name);
    }
  }

  get Online() {
    return this.__online;
  }
  set Online(value) {
    this.__online = value;
    if (value === true) {
      this.Status.zonesData = null; // Reset zones info
      this.Log.Log('Device came back online.');
      this.emit('device_online', this);
    } else {
      this.Log.Warn('Device went offline.');
      this.emit('device_offline', this);
    }
  }

  get ZonesCount() {
    return this.Status.zonesCount;
  }
  set ZonesCount(value) {
    if (this.Status.zonesCount != value) {
      this.Status.zonesCount = value;
      this.emit('new_zones_count', this.Status.zonesCount);
    }
  }

  get Infrared() {
    return this.Status.infrared;
  }
  set Infrared(value) {
    if (this.Status.infrared != value) {
      this.Status.infrared = value;
      // Send Command
      var LIFX_Device = this;
      this.__device.maxIR(value, function (err) {
        LIFX_Device.Log.Error(LIFX_Device.Name, ' maxIR(', value, '): ', err);
      });
    }
  }

  get OnOff() {
    if (this.FutureStatus.onoff != null) return this.FutureStatus.onoff;
    return this.Status.onoff;
  }
  set OnOff(value) {
    if (this.SupportsRelays === true) {
      this.SetAllRelays(value);
      return;
    }
    this.FutureStatus.onoff = value;
    this.__updateDevice();
  }
  SetOnOff(value, duration) {
    this.FutureStatus.onoff = value;
    this.__updateDebounceDataDuration(duration);
    this.__updateDevice();
  }

  /**
   * Sets a LIFX Switch relay status.
   * @param {number} idx Relay index starting at 0.
   * @param {boolean|number} value On/Off or percentage 0.0 to 1.0.
   */
  SetRelayStatus(idx, value) {
    var setOnOff = 0;
    if (typeof value === "boolean") {
      if (value === true) {
        setOnOff = 65535;
      } else {
        setOnOff = 0;
      }
    } else {
      setOnOff = this.Manager.MapScale(0, 1, 0, 65535, value);
    }
    this.Status.relayStatus[idx] = setOnOff;
    this.Manager.API_ToggleRelay(this, idx, setOnOff);
    var oldOverAllStatus = this.OnOff;
    this.__updateOverallRelayStatus();
    if (oldOverAllStatus != currentDevice.OnOff) {
      currentDevice.emit('new_relay_overall', currentDevice.OnOff);
    }
  }
  /**
   * Gets the status of a specific LIFX Switch relay.
   * @param {number} idx Relay index starting at 0.
   * @returns {number} Relay level as percentage.
   */
  GetRelayStatus(idx) {
    return this.Manager.MapScale(0, 65535, 0, 1, this.Status.relayStatus[idx]);
  }
  __updateOverallRelayStatus() {
    var setOnOff = false;
    for (var idx = 0; idx < this.Status.relaysCount; idx++) {
      if (this.Status.relayStatus[idx] > 0) setOnOff = true;
    }
    if (setOnOff != this.OnOff) {
      this.Status.onoff = setOnOff;
    }
  }
  /**
   * Sets all relays of the device in one go.
   * @param {boolean|number} value Set all relays either on/off or percentage.
   */
  SetAllRelays(value) {
    var setOnOff = 0;
    if (typeof value === "boolean") {
      if (value === true) {
        setOnOff = 65535;
      } else {
        setOnOff = 0;
      }
    } else {
      setOnOff = this.Manager.MapScale(0, 1, 0, 65535, value);
    }
    for (var idx = 0; idx < this.Status.relaysCount; idx++) {
      this.Status.relayStatus[idx] = setOnOff;
    }
    if (setOnOff > 0) {
      this.Status.onoff = true;
    } else {
      this.Status.onoff = false;
    }
  }
  get NumberOfRelays() {
    return this.Status.relaysCount;
  }
  get NumberOfPulledRelays() {
    var count = 0;
    for (var idx = 0; idx < this.Status.relaysCount; idx++) {
      if (this.Status.relayStatus[idx] > 0) count++;
    }
    return count;
  }
  get SwitchEnergyOverall() {
    var powerSum = 0;
    var sInfo = this.__getSwitchInfo(this.VendorId, this.ProductId);
    if (sInfo != null) {
      powerSum = sInfo.levels[0];
    }
    for (var idx = 0; idx < this.Status.relaysCount; idx++) {
      powerSum = powerSum + this.GetRelayPowerConsumption[idx];
    }
    return powerSum;
  }
  GetRelayPowerConsumption(rIdx) {
    //TODO: Relay power measuring protocol when available
    if (this.Status.relayStatus[rIdx] > 0) {
      return 0.3;
    } else {
      return 0;
    }
  }

  get DimLevel() {
    if (this.FutureStatus.dim != null) return this.FutureStatus.dim;
    return this.Status.dim;
  }
  set DimLevel(value) {
    this.FutureStatus.dim = value;
    this.__updateDevice();
  }
  SetDimLevel(value, duration) {
    this.FutureStatus.dim = value;
    this.__updateDebounceDataDuration(duration);
    this.__updateDevice();
  }

  get LightTemperature() {
    if (this.FutureStatus.temperature != null) return this.FutureStatus.temperature;
    return this.Status.temperature;
  }
  set LightTemperature(value) {
    this.FutureStatus.temperature = value;
    // Store Kelvin whilst in kelvin mode for restore purposes
    if (this.Status.saturation == 0) this.Status.temperatureCached = value;
    this.__updateDevice();
  }
  SetLightTemperature(value, duration) {
    this.FutureStatus.temperature = value;
    // Store Kelvin whilst in kelvin mode for restore purposes
    if (this.Status.saturation == 0) this.Status.temperatureCached = value;
    this.__updateDebounceDataDuration(duration);
    this.__updateDevice();
  }

  get LightColor() {
    if (this.FutureStatus.color != null) return this.FutureStatus.color;
    return this.Status.color;
  }
  set LightColor(value) {
    this.FutureStatus.color = value;
    this.__updateDevice();
  }
  SetLightColor(value, duration) {
    this.FutureStatus.color = value;
    this.__updateDebounceDataDuration(duration);
    this.__updateDevice();
  }
  SetLightColorByHex(hex, duration) {
    // Sanitize hex code first..
    var theoreticallyCleanHex = hex.trim();
    var lifxHsb = this.Manager.__getColorObjectFromHex(theoreticallyCleanHex, true);
    this.SetLightColor(lifxHsb.hue, duration);
    this.SetLightSaturation(lifxHsb.saturation / 100, duration);
    this.SetDimLevel(lifxHsb.brightness / 100, duration);
  }

  get LightSaturation() {
    if (this.FutureStatus.saturation != null) return this.FutureStatus.saturation;
    return this.Status.saturation;
  }
  set LightSaturation(value) {
    this.FutureStatus.saturation = value;
    // Store new sat for restore purposes on mode change
    if (value > 0.0) this.Status.saturationCached = value;
    this.__updateDevice();
  }
  SetLightSaturation(value, duration) {
    this.FutureStatus.saturation = value;
    // Store new sat for restore purposes on mode change
    if (value > 0.0) this.Status.saturationCached = value;
    this.__updateDebounceDataDuration(duration);
    this.__updateDevice();
  }

  get ColorMode() {
    if (this.SupportsColor === false) return false;
    if (this.Status.saturation == 0) return false;
    return true;
  }
  set ColorMode(value) {
    if (this.SupportsColor === true) {
      if (value === true) {
        // Restore original saturation setting
        if (this.LightSaturation == 0) this.LightSaturation = this.Status.saturationCached;
      } else {
        if (this.LightSaturation > 0) this.LightSaturation = 0;
        // Restore original kelvin setting
        this.LightTemperature = this.Status.temperatureCached;
      }
    }
  }

  get HevActive() {
    if (this.SupportsHev === true) {
      return this.Status.hev.toggle;
    } else {
      return false;
    }
  }

  set HevActive(value) {
    if (this.SupportsHev === true) {
      this.Manager.API_SetHevCycle(this, value);
    }
  }

  SetHevActive(duration) {
    if (this.SupportsHev === true) {
      this.Manager.API_SetHevCycle(this, true, duration);
    }
  }

  get HevRemaining() {
    if (this.SupportsHev === true) {
      return this.Status.hev.duration_remaining;
    } else {
      return 0;
    }
  }

  get HevDefault() {
    if (this.SupportsHev === true) {
      return this.Status.hev.duration_default;
    } else {
      return 0;
    }
  }

  get HevCurrent() {
    if (this.SupportsHev === true) {
      return this.Status.hev.duration_current;
    } else {
      return 0;
    }
  }

  /**
    0: SUCCESS
    1: BUSY
    2: INTERRUPTED_BY_RESET
    3: INTERRUPTED_BY_HOMEKIT
    4: INTERRUPTED_BY_LAN
    5: INTERRUPTED_BY_CLOUD
    255: NONE
   */
  get HevStatus() {
    if (this.SupportsHev === true) {
      return this.Status.hev.last_result;
    } else {
      return 255;
    }
  }

  get FirmwareMajorVersion() {
    if (this.Status.Firmware.majorVersion == null) return 0;
    return this.Status.Firmware.majorVersion;
  }
  get FirmwareMinorVersion() {
    if (this.Status.Firmware.minorVersion == null) return 0;
    return this.Status.Firmware.minorVersion;
  }

  async __updateDevice() {
    if (this.Ready === false || this.Online === false) {
      this.Log.Warn('Update command for non ready device! Ignoring command..');
      this.__resetDebounceData();
    }
    if (this.__updateTimeout) {
      // Clear timeout & Destroy Timeout
      clearTimeout(this.__updateTimeout);
      this.__updateTimeout = null;
    }
    let currentDevice = this;
    this.__updateTimeout = setTimeout(function () {
      currentDevice.Manager.__updateDeviceExecute(currentDevice);
    }, this.Manager.DebounceTime);
  }

  __resetDebounceData() {
    this.FutureStatus = {
      onoff: null,
      dim: null,
      temperature: null,
      color: null,
      saturation: null,
      duration: null
    }
  }
  __updateDebounceDataDuration(value) {
    if (this.FutureStatus.duration == null) {
      this.FutureStatus.duration = value;
    } else {
      if (this.FutureStatus.duration < value) this.FutureStatus.duration = value;
    }
  }

  __hasDebounceData() {
    if (this.FutureStatus.onoff == null
      && this.FutureStatus.dim == null
      && this.FutureStatus.temperature == null
      && this.FutureStatus.color == null
      && this.FutureStatus.saturation == null
      && this.FutureStatus.duration == null) {
      return false;
    }
    return true;
  }

  /**
  * Returns true if the minimum version requirement is met.
  * @param {string} versionMin Mimium version we want.
  * @param {string} versionToCheck The version to check against the minimum.
  * @returns {boolean} true if the minimum version requirement is met. false if not.
  */
  __versionSatisfiesMinimum(versionMin, versionToCheck) {
    var vMinArr = versionMin.split('.');
    var vChkArr = versionToCheck.split('.');
    if (parseInt(vChkArr[0]) > parseInt(vMinArr[0])) return true;
    if (parseInt(vChkArr[0]) == parseInt(vMinArr[0])) {
      if (parseInt(vChkArr[1]) >= parseInt(vMinArr[1])) return true;
    }
    return false;
  }

  constructor(device, manager) {
    super();
    this.__device = device;
    this.__inOnOffDebounce = 0;
    this.__inColorDebounce = 0;
    this.Manager = manager;
    this.Log = new Log('LIFX Device: ' + this.__device.id);
    this.Log.Log('Initializing..');
    // Product Info
    this.ProductName = '?';
    this.VendorName = '?';
    this.HardwareVersion = 0;
    this.ProductId = 0;
    this.VendorId = 0;
    // Hardware Info
    this.EnergyData = null;
    this.TemperatureRange = {
      Min: 3500,
      Max: 3500
    };
    this.SupportsColor = false;
    this.SupportsChain = false;
    this.SupportsMatrix = false;
    this.SupportsInfrared = false;
    this.SupportsMultizone = false;
    this.SupportsHev = false;
    this.SupportsRelays = false;
    this.SupportsButtons = false;
    this.SupportsTemperature = false;
    // Runtime Data
    this.Status = {
      name: '?',
      Wifi: {
        signal: 200,
        rx: 0,
        tx: 0,
        rescan_timeout: 1,
        Firmware: {
          majorVersion: 0,
          minorVersion: 0
        },
        FirmwareInfoRead: false
      },
      Init: {
        lightData: false,
        hwData: false
      },
      zonesData: null,
      zonesCount: 0,
      relaysCount: 0,
      relayStatus: [
        0,
        0,
        0,
        0
      ],
      hev: {
        duration_default: 0,
        duration_current: 0,
        duration_remaining: 0,
        last_result: 255, // None
        toggle: false
      },
      buttonsCount: null,
      onoff: false,
      infrared: 0,
      dim: 0,
      temperature: 0,
      temperatureCached: 0, // buffers the state mode independed to be able to restore the original value on mode change
      color: 0,
      saturation: 0,
      saturationCached: 1, // buffers the state mode independed to be able to restore the original value on mode change
      Firmware: {
        majorVersion: null,
        minorVersion: null
      }
    }
    // Date used to debounce setting commands
    this.FutureStatus = {
      onoff: null,
      dim: null,
      temperature: null,
      color: null,
      saturation: null,
      duration: null
    }
    // Meta Status Data
    this.Ready = false;
    this.Unsupported = false;
    this.__online = true;
    // Start device polling..
    let currentDevice = this;
    this.__devicePolling = setInterval(async function () {
      manager.__pollDeviceUpdate(currentDevice);
    }, manager.PollingInterval + Math.floor(Math.random() * (manager.KnownDevices.length * 1000)));
    manager.__pollDeviceUpdate(currentDevice);
    this.Log.Log('Initialized.');
  } // constructor

}

module.exports = LIFX_Device;
