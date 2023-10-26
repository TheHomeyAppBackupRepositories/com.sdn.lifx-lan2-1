'use strict';

const Homey = require('homey');
const Logger = require('../../lib/console_logger');

class LIFXDevice extends Homey.Device {

	__updateRelay(rIdx, value) {
		var onOff = false;
		if (value > 0) onOff = true;
		//TODO: Relay level dim update
		this.homey.app.updateCapability(this, `relay_${rIdx}`, `relay_${rIdx}`, onOff, false);
	}

	__updateMode(value) {
		var homeyValue = "temperature";
		if (value == true) {
			homeyValue = "color";
		}
		this.homey.app.updateCapability(this, 'light_mode', 'ColorMode', homeyValue, false);
	}

	__updateColor(value) {
		var hue = this.homey.app.LIFX_Manager.MapScale(0, 360, 0, 1, value);
		this.homey.app.updateCapability(this, 'light_hue', 'Hue', hue, false);
	}

	__updateSat(value) {
		this.homey.app.updateCapability(this, 'light_saturation', 'Sat', value, false);
	}

	__updateTemp(value) {
		this.homey.app.updateCapability(this, 'light_temperature', 'Temp', value, false);
	}

	__updateDim(value) {
		this.homey.app.updateCapability(this, 'dim', 'Dim', value, false);
	}

	__updateOnOff(value) {
		this.homey.app.updateCapability(this, 'onoff', 'OnOff', value, false);
	}

	__updateInfrared(value) {
		this.homey.app.updateCapability(this, 'infrared_max_level', 'Infrared', value, false);
	}

	__updateHevResult(result) {
		if (result == 0) {
			this.homey.app.updateCapability(this, 'hev_last_result', 'HEV Last Result', this.homey.__("inApp.hev.statusSuccess"), false);
			this.homey.app.updateCapability(this, 'hev_last_result_machine_readable', 'Machine Readable HEV Last Result', 'COMPLETED', false);
		} else if (result == 1) {
			this.homey.app.updateCapability(this, 'hev_last_result', 'HEV Last Result', this.homey.__("inApp.hev.statusBusy"), false);
			this.homey.app.updateCapability(this, 'hev_last_result_machine_readable', 'Machine Readable HEV Last Result', 'ACTIVE', false);
		} else if (result == 2) {
			this.homey.app.updateCapability(this, 'hev_last_result', 'HEV Last Result', this.homey.__("inApp.hev.statusReset"), false);
			this.homey.app.updateCapability(this, 'hev_last_result_machine_readable', 'Machine Readable HEV Last Result', 'STOPPED_BY_RESET', false);
		} else if (result == 3) {
			this.homey.app.updateCapability(this, 'hev_last_result', 'HEV Last Result', this.homey.__("inApp.hev.statusHomekit"), false);
			this.homey.app.updateCapability(this, 'hev_last_result_machine_readable', 'Machine Readable HEV Last Result', 'STOPPED_BY_HOMEKIT', false);
		} else if (result == 4) {
			this.homey.app.updateCapability(this, 'hev_last_result', 'HEV Last Result', this.homey.__("inApp.hev.statusLan"), false);
			this.homey.app.updateCapability(this, 'hev_last_result_machine_readable', 'Machine Readable HEV Last Result', 'STOPPED_BY_LAN', false);
		} else if (result == 5) {
			this.homey.app.updateCapability(this, 'hev_last_result', 'HEV Last Result', this.homey.__("inApp.hev.statusCloud"), false);
			this.homey.app.updateCapability(this, 'hev_last_result_machine_readable', 'Machine Readable HEV Last Result', 'STOPPED_BY_CLOUD', false);
		} else if (result == 255) {
			this.homey.app.updateCapability(this, 'hev_last_result', 'HEV Last Result', this.homey.__("inApp.hev.statusNone"), false);
			this.homey.app.updateCapability(this, 'hev_last_result_machine_readable', 'Machine Readable HEV Last Result', 'NO_STATUS', false);
		} else {
			this.homey.app.updateCapability(this, 'hev_last_result', 'HEV Last Result', this.homey.__("inApp.hev.statusUnknown"), false);
			this.homey.app.updateCapability(this, 'hev_last_result_machine_readable', 'Machine Readable HEV Last Result', 'UNKOWN_STATUS', false);
		}
	}

	__updateHevCycle(value) {
		this.homey.app.updateCapability(this, 'hev_toggle', 'HEV On/Off', value, false);
	}

	__updateHevCycleInfo_autoTick(current_device, data) {
		if (current_device.__hevProgress.timer != null) {
			clearTimeout(current_device.__hevProgress.timer);
			current_device.__hevProgress.timer = null;
		}
		if (data) {
			current_device.__hevProgress.last_duration = data.duration;
			current_device.__hevProgress.last_remaining = data.remaining;
		} else {
			if (current_device.__hevProgress.last_remaining > 0) current_device.__hevProgress.last_remaining--;
		}
		var newPercentage = Math.floor(this.homey.app.LIFX_Manager.MapScale(0, current_device.__hevProgress.last_duration, 100, 0, current_device.__hevProgress.last_remaining));
		if (newPercentage != current_device.__hevProgress.last_percentage) {
			//TODO: TEST: Trigger
			this.homey.app.updateCapability(current_device, 'hev_progress_percentage', 'HEV Remaining Percentage', newPercentage, false);
			let trigger_hev_tokens = {
				'hev_duration': current_device.__hevProgress.last_duration,
				'hev_remaining': current_device.__hevProgress.last_remaining,
				'hev_percentage': newPercentage
			};
			let trigger_hev_state = {
			};
			this.homey.app.Trigger_DeviceHevProgressUpdate.trigger(current_device, trigger_hev_tokens, trigger_hev_state)
				.then(() => {
					current_device.Log.Log("Fired Trigger_DeviceHevProgressUpdate for ", current_device.getName());
					return Promise.resolve();
				})
				.catch(err => {
					current_device.Log.Error("Fired Trigger_DeviceHevProgressUpdate for ", current_device.getName(), ' failed: ', err);
					return Promise.resolve();
				});
		}
		this.homey.app.updateCapability(current_device, 'hev_current_len', 'HEV Current Duration', current_device.__hevProgress.last_duration, false);
		this.homey.app.updateCapability(current_device, 'hev_remaining_len', 'HEV Remaining Duration', current_device.__hevProgress.last_remaining, true);
		current_device.__hevProgress.last_percentage = newPercentage;
		if (current_device.__hevProgress.last_remaining > 0) {
			current_device.__hevProgress.timer = setTimeout(() => {
				current_device.__updateHevCycleInfo_autoTick(current_device);
			}, 1000);
		}
	}

	__updateHevCycleInfo(value) {
		this.__updateHevCycleInfo_autoTick(this, value);
	}

	__updateHevCycleConfig(value) {
		this.homey.app.updateCapability(this, 'hev_default_len', 'HEV Default Duration', value, false);
	}

	async __updateRelaysCount(rCount) {
		let oldCount = this.getSettings('relaysCount');
		let settingsValue = '-';
		if (rCount > 0) settingsValue = rCount.toString();
		if (oldCount != settingsValue) {
			await this.setSettings({
				relaysCount: settingsValue
			}).catch(err => {
				this.Log.Error(this.LIFX_Device.Name, "setSettings(relaysCount):", err);
			})
		}
	}

	async __updateZonesCount(zCount) {
		let oldCount = this.getSettings('zonesCount');
		let settingsValue = '-';
		if (zCount > 0) settingsValue = zCount.toString();
		if (oldCount != settingsValue) {
			await this.setSettings({
				zonesCount: settingsValue
			}).catch(err => {
				this.Log.Error(this.LIFX_Device.Name, "setSettings(zonesCount):", err);
			})
		}
	}

	__setOnlineState(state) {
		if (state === true) {
			this.setAvailable();
		} else {
			this.setUnavailable(this.homey.__("inAppErrors.deviceOffline"));
		}
	}

	async onSettings(oldSettingsObj, newSettingsObj, changedKeysArr) {
		// run when the user has changed the device's settings in Homey.
		// changedKeysArr contains an array of keys that have been changed
		// if the settings must not be saved for whatever reason:
		throw new Error(this.homey.__('inAppErrors.advSettingsReadOnly'));
	}

	async onDeleted() {
		this.log('onDeleted: ', this.getName());
		if (this.waitDeviceInitTimeout != null) {
			clearTimeout(this.waitDeviceInitTimeout);
			this.waitDeviceInitTimeout = null;
		}
		if (this.waitDeviceTimeout != null) {
			clearTimeout(this.waitDeviceTimeout);
			this.waitDeviceTimeout = null;
		}
		if (this.LIFX_Device != null) {
			this.LIFX_Device.removeAllListeners();
		}
	}

	async onRenamed(new_name) {
		this.log('onRenamed to: ', new_name);
		var device_data = this.getData();
		// Check for valid new name
		if (this.LIFX_Device != null && typeof device_data === "object" && typeof new_name === "string" && new_name !== '') {
			this.LIFX_Device.Name = new_name;
		}
	}

	onInit() {
		let dev_data = this.getData();
		this.Log = new Logger(`LIFX LAN Device: ${dev_data.id}`);
		this.Log.Log(this.getName(), ' initializing..');
		this.LIFX_Device = null;
		this.__needUpdateSubscriptions = true; // whether to subscribe update events on WaitOnDeviceInit. This should be done once only!
		this.waitDeviceTimeout = null;
		this.waitDeviceInitTimeout = null;
		//TODO: Replace with power measurement events when available
		this.PowerMonitor = null;
		// HEV Progress Handling
		this.__hevProgress = {
			last_duration: 0,
			last_remaining: 0,
			last_percentage: 100,
			timer: null
		};
		// Register light capability listeners
		this.registerCapabilityListener('light_hue', this.onCapabilityHue.bind(this));
		this.registerCapabilityListener('light_temperature', this.onCapabilityTemp.bind(this));
		this.registerCapabilityListener('light_saturation', this.onCapabilitySat.bind(this));
		this.registerCapabilityListener('light_mode', this.onCapabilityMode.bind(this));
		this.registerCapabilityListener('infrared_max_level', this.onCapabilityInfrared.bind(this));
		this.registerCapabilityListener('onoff', this.onCapabilityOnOff.bind(this));
		this.registerCapabilityListener('dim', this.onCapabilityDim.bind(this));
		// Register relay capability listners
		this.registerCapabilityListener('relay_0', this.onCapabilityRelay_0_OnOff.bind(this));
		this.registerCapabilityListener('relay_1', this.onCapabilityRelay_1_OnOff.bind(this));
		this.registerCapabilityListener('relay_2', this.onCapabilityRelay_2_OnOff.bind(this));
		this.registerCapabilityListener('relay_3', this.onCapabilityRelay_3_OnOff.bind(this));
		// Hev cycle control
		this.registerCapabilityListener('hev_toggle', this.onCapabilityHev_OnOff.bind(this));
		// Install status polling
		this.homey.app.WaitOnDevice(this);
		this.Log.Log(this.getName(), ' initialized.');
	} //onInit

	async onCapabilityHev_OnOff(value, opts) {
		this.Log.Log('onCapabilityHev_OnOff: ', value, opts);
		if (this.LIFX_Device == null) return Promise.reject();
		if (this.LIFX_Device.SupportsHev === true) {
			if (opts.duration) {
				this.LIFX_Device.SetHevActive(value, opts.duration);
			} else {
				this.LIFX_Device.HevActive = value;
			}
		}
		return Promise.resolve();
	}

	async onCapabilityRelay_0_OnOff(value, opts) {
		if (this.LIFX_Device == null) return Promise.reject();
		this.homey.app.onCapabilityRelay_FireTrigger(this, 0, value);
		this.LIFX_Device.SetRelayStatus(0, value);
		return Promise.resolve();
	}

	async onCapabilityRelay_1_OnOff(value, opts) {
		if (this.LIFX_Device == null) return Promise.reject();
		this.homey.app.onCapabilityRelay_FireTrigger(this, 1, value);
		this.LIFX_Device.SetRelayStatus(1, value);
		return Promise.resolve();
	}

	async onCapabilityRelay_2_OnOff(value, opts) {
		if (this.LIFX_Device == null) return Promise.reject();
		this.homey.app.onCapabilityRelay_FireTrigger(this, 2, value);
		this.LIFX_Device.SetRelayStatus(2, value);
		return Promise.resolve();
	}

	async onCapabilityRelay_3_OnOff(value, opts) {
		if (this.LIFX_Device == null) return Promise.reject();
		this.homey.app.onCapabilityRelay_FireTrigger(this, 3, value);
		this.LIFX_Device.SetRelayStatus(3, value);
		return Promise.resolve();
	}

	async onCapabilityInfrared(max_ir, opts) {
		this.Log.Log('onCapabilityInfrared: ', max_ir, opts);
		if (this.LIFX_Device == null) return Promise.reject();
		this.LIFX_Device.Infrared = max_ir;
		return Promise.resolve();
	}

	async onCapabilityMode(new_mode, opts) {
		this.Log.Log('onCapabilityMode: ', new_mode, opts);
		if (this.LIFX_Device == null) return Promise.reject();
		if (new_mode == 'color') {
			this.LIFX_Device.ColorMode = true;
		} else {
			this.LIFX_Device.ColorMode = false;
		}
		return Promise.resolve();
	} //onCapabilityMode

	async onCapabilitySat(sat, opts) {
		this.Log.Log('onCapabilitySat: ', sat, opts);
		if (this.LIFX_Device == null) return Promise.reject();
		if (opts.duration) {
			this.LIFX_Device.SetLightSaturation(sat, opts.duration);
		} else {
			this.LIFX_Device.LightSaturation = sat;
		}
		return Promise.resolve();
	} //onCapabilitySat

	async onCapabilityTemp(temp, opts) {
		this.Log.Log('onCapabilityTemp: ', temp, opts);
		if (this.LIFX_Device == null) return Promise.reject();
		this.LIFX_Device.ColorMode = false;
		if (opts.duration) {
			this.LIFX_Device.SetLightTemperature(temp, opts.duration);
		} else {
			this.LIFX_Device.LightTemperature = temp;
		}
		return Promise.resolve();
	} //onCapabilityTemp

	async onCapabilityHue(light_hue, opts) {
		this.Log.Log('onCapabilityHue: ', light_hue, opts);
		if (this.LIFX_Device == null) return Promise.reject();
		var hue = this.homey.app.LIFX_Manager.MapScale(0, 1, 0, 360, light_hue);
		if (opts.duration) {
			this.LIFX_Device.SetLightColor(hue, opts.duration);
		} else {
			this.LIFX_Device.LightColor = hue;
		}
		return Promise.resolve();
	} //onCapabilityHue

	async onCapabilityDim(dim, opts) {
		this.Log.Log('onCapabilityDim: ', dim, opts);
		if (this.LIFX_Device == null) return Promise.reject();
		if (opts.duration) {
			this.LIFX_Device.SetDimLevel(dim, opts.duration);
		} else {
			this.LIFX_Device.DimLevel = dim;
		}
		return Promise.resolve();
	} //onCapabilityDim

	// this method is called when the Device has requested a state change (turned on or off)
	async onCapabilityOnOff(value, opts) {
		this.Log.Log('onCapabilityOnOff: ', value, opts);
		if (this.LIFX_Device == null) return Promise.reject();
		if (this.LIFX_Device.SupportsRelays === true) {
			for (var rIdx = 0; rIdx < 4; rIdx++) {
				var relayOldState = (this.LIFX_Device.GetRelayStatus(rIdx) > 0) ? true : false;
				if (value != relayOldState) {
					this.homey.app.onCapabilityRelay_FireTrigger(this, rIdx, value);
				}
			}
		}
		if (opts.duration) {
			this.LIFX_Device.SetOnOff(value, opts.duration);
		} else {
			this.LIFX_Device.OnOff = value;
		}
		return Promise.resolve();
	} //onCapabilityOnoff

}

module.exports = LIFXDevice;