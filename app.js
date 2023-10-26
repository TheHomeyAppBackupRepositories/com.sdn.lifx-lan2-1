'use strict';

const Homey = require('homey');
// Athom Web API Support
const { HomeyAPI } = require('athom-api');
// Other
const ldash = require('lodash');
const Logger = require('./lib/console_logger')
// Cloud Support
const LIFX_CloudApi = require('./lib/cloudSupportClient');
const LIFX_Manager = require('./lib/lifx_manager');
const LIFX_Effect = require('./lib/lifx_effect');
// Special needs department
const Crypto = require("crypto");
const FileSystem = require('fs');
const OS = require("os");
const LicManager = require('./lib/license_manager');

class SDN_LIFX_LAN2 extends Homey.App {

	async sendMsgToTimeline(message) {
		this.homey.notifications.createNotification({ excerpt: message })
			.catch(err => {
				this.Log.Warn('sendMsgToTimeline: ', err);
			});
	}

	async getDeviceId() {
		return await OS.hostname();
	}

	async getAppRegistrationRequestCode() {
		var deviceId = await this.homey.app.getDeviceId();
		var lm = new LicManager(deviceId);
		return lm.GetRegistrationRequestCode();
	}

	async getAppRegistered() {
		var deviceId = await this.homey.app.getDeviceId();
		var lm = new LicManager(deviceId);
		var resultCode = lm.Authorized(this.homey.app.appRegKey, this.homey.app.appRegEmail);
		if (resultCode == 2) {
			this.homey.settings.set('appRegKey', '');
		}
		return resultCode;
	}

	get appRegEmail() {
		var email = this.homey.settings.get('appRegEmail');
		if (!email || email == null || email.length < 5) email = '';
		return email;
	}

	get appRegKey() {
		return this.homey.settings.get('appRegKey');
	}

	__getRandomHexId() {
		return Crypto.randomBytes(16).toString("hex");
	}

	__isCustomEffectRunning(id) {
		var ceRunning = false;
		for (var idx = 0; idx < this.homey.app.LIFX_Effect_CEInstances.length; idx++) {
			if (this.homey.app.LIFX_Effect_CEInstances[idx].id == id && this.homey.app.LIFX_Effect_CEInstances[idx].e.Active === true) {
				ceRunning = true;
				break;
			}
		}
		return ceRunning;
	}

	__startCustomEffect(id, restoreDevicesOnEnd) {
		let self = this;
		// First check if this effect is already active..
		var ceRunning = false;
		for (var idx = 0; idx < this.homey.app.LIFX_Effect_CEInstances.length; idx++) {
			if (this.homey.app.LIFX_Effect_CEInstances[idx].id == id && this.homey.app.LIFX_Effect_CEInstances[idx].e.Active === true) {
				ceRunning = true;
				break;
			}
		}
		if (ceRunning === true) {
			this.homey.app.Log.Log('CE ', id, ' is running already.');
			return false;
		}
		var apiData = this.homey.app.__getCustomEffect(id);
		if (apiData.type == 'CE') {
			// Convert zone configuration to LIFX_Effect zone data..
			var lifxZones = [];
			apiData.ce.z.forEach(zone => {
				var zoneDevices = [];
				zone.forEach(zoneDeviceId => {
					let lifxDevice = this.homey.app.LIFX_Manager.GetDeviceById(zoneDeviceId);
					if (lifxDevice != null) {
						zoneDevices.push(lifxDevice);
					} else {
						this.homey.app.Log.Log('CE Zone Device ', zoneDeviceId, ' not found, skipping it..');
					}
				});
				lifxZones.push(zoneDevices);
			});
			// Create effect instance..
			var ceEffectInstance = new LIFX_Effect(apiData.ce.c, lifxZones);
			if (restoreDevicesOnEnd && restoreDevicesOnEnd === false) ceEffectInstance.RestoreLightsAfterEventEnds = restoreDevicesOnEnd;
			// Run effect
			ceEffectInstance.Start();
			this.homey.app.LIFX_Effect_CEInstances.push({
				id: id,
				e: ceEffectInstance
			});
			ceEffectInstance.on('effect_ended', function () {
				ceEffectInstance.removeAllListeners();
				self.homey.app.__cleanupCEEffectsList();
			});
			return true;
		} else {
			return false;
		}
	}

	__cleanupCEEffectsList() {
		var cleaning = true;
		while (cleaning) {
			cleaning = false;
			for (var idx = 0; idx < this.homey.app.LIFX_Effect_CEInstances.length; idx++) {
				if (this.homey.app.LIFX_Effect_CEInstances[idx].e.Active === false) {
					cleaning = true;
					this.homey.app.LIFX_Effect_CEInstances.splice(idx, 1);
					break;
				}
			}
		}
	}

	__stopCustomEffect(id) {
		this.homey.app.LIFX_Effect_CEInstances.forEach(knownEffect => {
			if (knownEffect.id == id && knownEffect.e.Active === true) knownEffect.e.Stop();
		});
	}

	__stopAllCustomEffects() {
		var success = true;
		try {
			this.homey.app.LIFX_Effect_CEInstances.forEach(knownEffect => {
				if (knownEffect.e.Active === true) knownEffect.e.Stop();
			});
		}
		catch (err) {
			this.homey.app.Log.Warn('__stopAllCustomEffects: ', err);
			success = false;
		}
		return success;
	}

	__StopAllBuildinEffects() {
		var success = true;
		try {
			this.homey.app.LIFX_Effect_Instances.forEach(knownEffect => {
				if (knownEffect.e.Active === true) knownEffect.e.Stop();
			});
		}
		catch (err) {
			this.homey.app.Log.Warn('__StopAllBuildinEffects: ', err);
			success = false;
		}
		return success;
	}

	__getCustomEffectsIndex() {
		let foundEffects = [];
		FileSystem.readdirSync('/userdata/effects/').forEach(file => {
			let stringData = FileSystem.readFileSync(`/userdata/effects/${file}`, 'utf-8');
			let ce = JSON.parse(stringData);
			foundEffects.push({
				id: file,
				name: ce.c.Name,
				zcnt: ce.z.length,
				loop: ce.c.Looped
			});
		});
		return foundEffects;
	}

	/*
		Custom Effect Error Message Format
		{
			type: "ERROR",
			msg: "Explanatory message"
		}
	*/

	__createNewCustomEffect() {
		var newId = this.homey.app.__getRandomHexId();
		while (FileSystem.existsSync(`/userdata/effects/${newId}`)) {
			newId = this.homey.app.__getRandomHexId();
		}
		var ce = {
			c: {
				"Name": this.homey.__('ceExtension.ceUntitled'),
				"Looped": false,
				"IgnorePlayed": true,
				"InitCmds": [],
				"InitLinger": 0,
				"Choreo": []
			},
			z: []
		}
		FileSystem.writeFileSync(`/userdata/effects/${newId}`, JSON.stringify(ce), 'utf-8');
		return { type: "CE", ceid: newId, ce: ce };
	}

	__getCustomEffect(id, createClone) {
		if (FileSystem.existsSync(`/userdata/effects/${id}`)) {
			let stringData = FileSystem.readFileSync(`/userdata/effects/${id}`, 'utf-8');
			let ce = JSON.parse(stringData);
			if (createClone && createClone === true) {
				var newId = this.homey.app.__getRandomHexId();
				while (FileSystem.existsSync(`/userdata/effects/${newId}`)) {
					newId = this.homey.app.__getRandomHexId();
				}
				// Got unique new name!
				// Cloning..
				ce.c.Name = `${this.homey.__('ceExtension.caCopyOf')}${ce.c.Name}`;
				FileSystem.writeFileSync(`/userdata/effects/${newId}`, JSON.stringify(ce), 'utf-8');
				id = newId;
			}
			return { type: "CE", ceid: id, ce: ce };
		} else {
			return { type: "ERROR", msg: this.homey.__('inApp.customEffects.ceDoesNotExist') };
		}
	}

	__saveCustomEffect_validateAttrRange(attr, min, max, allowNull) {
		if (allowNull && attr === null) return true;
		if (typeof attr == 'number') {
			if (attr < min || attr > max) {
				return false;
			} else {
				return true;
			}
		} else {
			return false;
		}
	}

	__saveCustomEffect_validateColor(col) {
		if (typeof col == 'string') {
			if (/^#[0-9a-f]{6}?$/i.test(col)) {
				return true;
			} else {
				return false;
			}
		}
		if (typeof col.H == 'number') {
			if (this.__saveCustomEffect_validateAttrRange(col.H, 0, 360, true) === false) {
				return false;
			}
		} else {
			col.H = null;
		}
		if (typeof col.S == 'number') {
			if (this.__saveCustomEffect_validateAttrRange(col.S, 0, 100, true) === false) {
				return false;
			}
		} else {
			col.S = null;
		}
		if (typeof col.B == 'number') {
			if (this.__saveCustomEffect_validateAttrRange(col.B, 0, 100, true) === false) {
				return false;
			}
		} else {
			col.B = null;
		}
		if (typeof col.K == 'number') {
			if (this.__saveCustomEffect_validateAttrRange(col.K, 0, 1, true) === false) {
				return false;
			}
		} else {
			col.K = null;
		}
	}

	__saveCustomEffect_validateCmd(cmd) {
		if (this.__saveCustomEffect_validateAttrRange(cmd.Zone, -1, 10) === false) {
			return `Zone: ${this.homey.__('inApp.customEffects.ceOutOfRangeOrWrongType')} (-1 - 10)`;
		}
		if (typeof cmd.AllZ != 'boolean') {
			return `All Zones: ${this.homey.__('inApp.customEffects.ceWrongDataType')}`;
		}
		if (this.__saveCustomEffect_validateAttrRange(cmd.Type, 0, 1) === false) {
			return `Type: ${this.homey.__('inApp.customEffects.ceOutOfRangeOrWrongType')} (0 - 1)`;
		}
		if (this.__saveCustomEffect_validateAttrRange(cmd.Len, 0, 600000) === false) {
			return `Len: ${this.homey.__('inApp.customEffects.ceOutOfRangeOrWrongType')} (0 - 600000)`;
		}
		if (cmd.LenMode && cmd.LenMode > 0) {
			if (cmd.LenMode < 0 || cmd.LenMode > 2) cmd.LenMode = 0;
			if (cmd.LenMax && cmd.LenMax !== null && cmd.Len && cmd.Len !== null) {
				if (cmd.LenMax < cmd.Len) cmd.LenMax = null;
				if (this.__saveCustomEffect_validateAttrRange(cmd.LenMax, 0, 600000) === false) {
					return `LenMax: ${this.homey.__('inApp.customEffects.ceOutOfRangeOrWrongType')} (0 - 600000)`;
				}
			}
		}
		if (this.__saveCustomEffect_validateColor(cmd.Color) === false) {
			return `Color: ${this.homey.__('inApp.customEffects.ceColorOutOfRange')}`;
		}
		if (cmd.ColorMax) {
			if (typeof cmd.ColorMax != 'string' && typeof cmd.Color != 'string') {
				if (cmd.ColorMax.H !== null && cmd.Color.H !== null && cmd.ColorMax.H < cmd.Color.H) cmd.Color.H = cmd.ColorMax.H;
				if (cmd.ColorMax.S !== null && cmd.Color.S !== null && cmd.ColorMax.S < cmd.Color.S) cmd.Color.S = cmd.ColorMax.S;
				if (cmd.ColorMax.B !== null && cmd.Color.B !== null && cmd.ColorMax.B < cmd.Color.B) cmd.Color.B = cmd.ColorMax.B;
				if (cmd.ColorMax.K !== null && cmd.Color.K !== null && cmd.ColorMax.K < cmd.Color.K) cmd.Color.K = cmd.ColorMax.K;
			}
			if (this.__saveCustomEffect_validateColor(cmd.ColorMax) === false) {
				return `ColorMax: ${this.homey.__('inApp.customEffects.ceColorOutOfRange')}`;
			}
		}
		if (cmd.ColorRndMode && cmd.ColorRndMode < 0 || cmd.ColorRndMode > 2) cmd.ColorRndMode = 0;
		// Do additional checks for different command types..
		if (cmd.Type == 1) {
			if (typeof cmd.Trans != 'boolean') return `Transient: ${this.homey.__('inApp.customEffects.ceWrongDataType')}`;
			if (this.__saveCustomEffect_validateAttrRange(cmd.Rep, 1, 10) === false) {
				return `Repetitions: ${this.homey.__('inApp.customEffects.ceOutOfRangeOrWrongType')} (1 - 10)`;
			}
			if (this.__saveCustomEffect_validateAttrRange(cmd.Skew, 0, 1) === false) {
				return `Skew: ${this.homey.__('inApp.customEffects.ceOutOfRangeOrWrongType')} (0 - 1)`;
			}
			if (this.__saveCustomEffect_validateAttrRange(cmd.Wave, 0, 4) === false) {
				return `Wave: ${this.homey.__('inApp.customEffects.ceOutOfRangeOrWrongType')} (0 - 4)`;
			}
		}
		return true;
	}

	__saveCustomEffect_validateChoStep(cho) {
		var errors = '';
		if (this.__saveCustomEffect_validateAttrRange(cho.Linger, 0, 600000) === false) {
			return `Linger: ${this.homey.__('inApp.customEffects.ceOutOfRangeOrWrongType')} (0 - 600000)`;
		}
		if (this.__saveCustomEffect_validateAttrRange(cho.LingerMax, 0, 600000, true) === false) {
			return `LingerMAx: ${this.homey.__('inApp.customEffects.ceOutOfRangeOrWrongType')} (0 - 600000)`;
		}
		if (cho.LingerMax && cho.LingerMax != null && cho.LingerMax < cho.Linger) cho.LingerMax = cho.Linger;
		if (typeof cho.RndNext != 'boolean') {
			return `Random Next: ${this.homey.__('inApp.customEffects.ceWrongDataType')}`;
		}
		if (cho.RndBlock) {
			if (typeof cho.RndBlock != 'boolean') {
				return `Random Block: ${this.homey.__('inApp.customEffects.ceWrongDataType')}`;
			}
		}
		cho.Played = false;
		cho.Cmds.forEach(element => {
			var result = this.__saveCustomEffect_validateCmd(element);
			if (typeof result != 'boolean') {
				errors = `${errors} ${result}`;
			}
		});
		if (errors == '') errors = true;
		return errors;
	}

	__saveCustomEffect(id, data) {
		// Validate payload data
		if (data.c.Name.length > 30) {
			return { type: "ERROR", msg: this.homey.__('inApp.customEffects.ceNameTooLong') };
		}
		this.homey.app.Log.Log('__saveCustomEffect: Name valid.');
		// Looped
		if (data.c.Looped) {
			if (typeof data.c.Looped != 'boolean') {
				return { type: "ERROR", msg: `${this.homey.__('ceExtension.cEntryLabelLoopChoreo')}: ${this.homey.__('inApp.customEffects.ceWrongDataType')}` };
			}
		} else {
			data.c.Looped = false;
		}
		this.homey.app.Log.Log('__saveCustomEffect: Looped valid.');
		// IgnorePlayed
		if (data.c.IgnorePlayed) {
			if (typeof data.c.IgnorePlayed != 'boolean') {
				return { type: "ERROR", msg: `${this.homey.__('ceExtension.cEntryLabelIgnorePlayed')}: ${this.homey.__('inApp.customEffects.ceWrongDataType')}` };
			}
		} else {
			data.c.IgnorePlayed = false;
		}
		this.homey.app.Log.Log('__saveCustomEffect: IgnorePlayed valid.');
		// InitLinger
		if (this.__saveCustomEffect_validateAttrRange(data.c.InitLinger, 0, 600000) === false) {
			return { type: "ERROR", msg: `${this.homey.__('ceExtension.cEntryLabelLingerStartup')}: ${this.homey.__('inApp.customEffects.ceOutOfRangeOrWrongType')} (0 - 600000)` };
		}
		this.homey.app.Log.Log('__saveCustomEffect: InitLinger valid.');
		var errors = '';
		data.c.InitCmds.forEach(element => {
			var result = this.__saveCustomEffect_validateCmd(element, true);
			if (typeof result != 'boolean') {
				errors = `${errors} ${result}`;
			}
		});
		this.homey.app.Log.Log('__saveCustomEffect: Errors after InitCmds: ', errors);
		data.c.Choreo.forEach(element => {
			var result = this.__saveCustomEffect_validateChoStep(element);
			if (typeof result != 'boolean') {
				errors = `${errors} ${result}`;
			}
		});
		if (data.c.Choreo.length == 0) {
			errors = `${errors} ${this.homey.__('ceExtension.msgWarningNoChoreo')}`;
		}
		// Safty check for looped effects
		if (data.c.Looped === true) {
			var highestLingerMin = 0;
			data.c.Choreo.forEach(element => {
				if (element.Linger > highestLingerMin) highestLingerMin = element.Linger;
			});
			if (highestLingerMin == 0) errors = `${errors} ${this.homey.__('ceExtension.msgWarningLoopWithoutLinger')}`;
		}
		this.homey.app.Log.Log('__saveCustomEffect: Errors after Choreo: ', errors);
		if (errors != '') return { type: "ERROR", msg: errors };
		// Handle import request
		if (id == 'IMPORT_REQUEST') {
			var placeholderEffect = this.__createNewCustomEffect();
			id = placeholderEffect.ceid;
		}
		if (FileSystem.existsSync(`/userdata/effects/${id}`)) {
			FileSystem.writeFileSync(`/userdata/effects/${id}`, JSON.stringify(data), 'utf-8');
			return { type: "MSG", title: this.homey.__('ceExtension.ceSaved'), msg: data.c.Name };
		} else {
			return { type: "ERROR", msg: this.homey.__('ceExtension.ceSaveFail') };
		}
	}

	__deleteCustomEffect(id) {
		if (FileSystem.existsSync(`/userdata/effects/${id}`)) {
			FileSystem.unlinkSync(`/userdata/effects/${id}`);
			return { type: "MSG", title: this.homey.__('ceExtension.ceDeleted'), msg: '' };
		} else {
			return { type: "ERROR", msg: this.homey.__('inApp.customEffects.ceDoesNotExist') };
		}
	}

	// Returns an instance of the Web API Interface
	getWebApi() {
		if (!this.webApi) {
			this.webApi = HomeyAPI.forCurrentHomey(this.homey);
		}
		return this.webApi;
	}

	// Returns a list of all devices known to the current Homey
	async getAllDevices() {
		var tsNow = Date.now();
		if (this.homey.app.__webApiCache.DAge == null || tsNow - this.homey.app.__webApiCache.DAge >= this.homey.app.__webApiCache.MaxAge) {
			this.homey.app.Log.Log('WebAPI Devices cache is outdated. Refreshing..');
			try {
				const api = await this.getWebApi();
				let allDevices = await api.devices.getDevices();
				let new_devices = [];
				for (var key in allDevices) {
					if (!allDevices.hasOwnProperty(key)) continue;
					var device = allDevices[key];
					if (device.driverUri == 'homey:app:com.sdn.lifx-lan2') {
						let new_device = {
							name: device.name,
							id: device.id,
							zone_id: device.zone,
							device_id: device.data.id
						}
						new_devices.push(new_device);
					}
				}
				this.homey.app.__webApiCache.Devices = new_devices;
				this.homey.app.__webApiCache.DAge = tsNow;
				return new_devices;
			}
			catch (err) {
				this.homey.app.Log.Warn('WebAPI failure! Using cached device data: ', err);
				return this.homey.app.__webApiCache.Devices;
			}
		} else {
			return this.homey.app.__webApiCache.Devices;
		}
	}

	// Returns a list of all zones known to the current Homey
	async getAllZones() {
		var tsNow = Date.now();
		if (this.homey.app.__webApiCache.ZAge == null || tsNow - this.homey.app.__webApiCache.ZAge >= this.homey.app.__webApiCache.MaxAge) {
			this.homey.app.Log.Log('WebAPI Zones cache is outdated. Refreshing..');
			try {
				const api = await this.getWebApi();
				let allZones = await api.zones.getZones();
				let new_zones = [];
				for (var key in allZones) {
					if (!allZones.hasOwnProperty(key)) continue;
					var zone = allZones[key];
					let newZoneName = zone.name;
					let parentZoneLabel = '';
					if (zone.parent) {
						parentZoneLabel = await this.homey.app.getZone(zone.parent).then(pZone => {
							return `${this.homey.__('inApp.parentZone')}: ${pZone.name}`;
						});
					}
					let new_zone = {
						name: newZoneName,
						description: parentZoneLabel,
						id: zone.id,
						parent: zone.parent
					};
					new_zones.push(new_zone);
				}
				this.homey.app.__webApiCache.Zones = new_zones;
				this.homey.app.__webApiCache.ZAge = tsNow;
				return Promise.resolve(new_zones);
			}
			catch (err) {
				this.homey.app.Log.Warn('WebAPI failure! Using cached zone data: ', err);
				return Promise.resolve(this.homey.app.__webApiCache.Zones);
			}
		} else {
			return Promise.resolve(this.homey.app.__webApiCache.Zones);
		}
	}

	// Get a specific zone by ID
	async getZone(id) {
		const api = await this.getWebApi();
		let theZone = await api.zones.getZone({ id: id });
		let new_zone = {};
		ldash.assign(new_zone, theZone);
		let new_return_zone = {
			name: new_zone.name,
			id: new_zone.id,
			parent: new_zone.parent
		};
		return new_return_zone;
	}

	/**
	 * Returns an array with all child zones of a given zone based on allZones given.
	 * @param {*} parentZone Parent zone to look for child zones for.
	 * @param {*} allZones Array with all available zones.
	 */
	addChildZones(parentZone, allZones) {
		let self = this;
		let newZones = [];
		allZones.forEach(function (zone) {
			if (zone.parent == parentZone.id) {
				newZones.push(zone);
				let additonalZones = self.homey.app.addChildZones(zone, allZones);
				additonalZones.forEach(function (childZone) {
					newZones.push(childZone);
				});
			}
		});
		return newZones;
	}

	/**
	 * Returns a LIFX device list contained in the zone tree starting at the given zone and below.
	 * @param {ZoneObject} givenZone The zone to get devices of.
	 * @param {boolean} noSubZones If set to true will to exlude any subzones from the result.
	 */
	async getDeviceOfZoneTree(givenZone, noSubZones) {
		let deviceList = await this.homey.app.getAllDevices();
		let allZones = await this.homey.app.getAllZones().then(zones => {
			return Promise.resolve(zones);
		});
		let zoneList = [];
		if (noSubZones && noSubZones === true) {
			zoneList.push(givenZone);
		} else {
			zoneList = this.homey.app.addChildZones(givenZone, allZones);
			zoneList.push(givenZone);
		}
		let filteredDevices = [];
		deviceList.forEach(function (listed_device) {
			zoneList.forEach(function (listed_zone) {
				if (listed_device.zone_id == listed_zone.id) {
					filteredDevices.push(listed_device);
				}
			});
		});
		return Promise.resolve(filteredDevices);
	}

	/**
	 * Called when the manager instance detects a new device on the network.
	 * @param {*} lifx_device 
	 */
	async __deviceDetected(lifx_device) {
		this.Log.Log('New device signaled: ', lifx_device.DeviceID);
	}

	async __notifyUnsupportedDevice(lifxDevice) {
		this.sendMsgToTimeline(`WARNING: Unsupported device detected! Please contact the app developer with this info: **${lifxDevice.VendorId}-${lifxDevice.ProductId}**`);
	}

	/**
	 * Returns a device paired to this app or null.
	 * @param {string} id A devices actual hardware ID.
	 * @returns {HomeyDevice} This is null if no device was found.
	 */
	__getPairedDeviceById(id) {
		let foundDevice = null;
		let lifxDrivers = this.homey.drivers.getDrivers();
		for (const [key, lifxDriver] of Object.entries(lifxDrivers)) {
			let lifxDevices = lifxDriver.getDevices();
			for (var i = 0; i < lifxDevices.length; i++) {
				let deviceData = lifxDevices[i].getData();
				if (deviceData.id == id) {
					foundDevice = lifxDevices[i];
					break;
				}
			}
			if (foundDevice != null) break;
		}
		return foundDevice;
	}

	/**
	 * Returns a list of unpaired LIFX Devices. The filters are optional but if set both are required to be set.
	 * @param {int} vendorFilter A vendor ID. 
	 * @param {string} productFilter A dedicated product name. Mandatory if vendorFilter is set.
	 * @returns {array} An array of matching devices.
	 */
	GetSupportedDevices(vendorFilter, productFilter) {
		let foundDevices = [];
		let self = this;
		this.LIFX_Manager.KnownDevices.forEach(function (lifxDevice) {
			self.homey.app.Log.Log('GetSupportedDevices Scanning: ', lifxDevice.DeviceID, ' as ', lifxDevice.Name);
			if (lifxDevice.Unsupported === true) {
				self.homey.app.__notifyUnsupportedDevice(lifxDevice);
			} else if (lifxDevice.Ready === true && lifxDevice.Online === true) {
				if (self.homey.app.__getPairedDeviceById(lifxDevice.DeviceID) == null) {
					if (vendorFilter) {
						if (vendorFilter == lifxDevice.VendorId) {
							if (productFilter == lifxDevice.ProductName) {
								self.homey.app.Log.Log('GetSupportedDevices Adding: ', lifxDevice.ProductName, '(', lifxDevice.DeviceID, ') as ', lifxDevice.Name);
								foundDevices.push(lifxDevice);
							}
						}
					} else {
						self.homey.app.Log.Log('GetSupportedDevices Adding: ', lifxDevice.ProductName, '(', lifxDevice.DeviceID, ') as ', lifxDevice.Name);
						foundDevices.push(lifxDevice);
					}
				}
			}
		});
		return foundDevices;
	}

	async __getApp() {
		let thisApp = null;
		try {
			const api = await this.getWebApi();
			const apps = await api.apps.getApps();
			ldash.forEach(apps, async (app) => {
				if (app.id == 'com.sdn.lifx-lan2') {
					thisApp = app;
					return false;
				}
			});
		}
		catch (err) {
			this.Log.Error('__getApp() failed: ', err);
			thisApp = null;
		}
		return thisApp;
	}

	async __ramMonitor() {
		const app = await this.__getApp();
		if (app == null) {
			this.Log.Error('__ramMonitor() could not get the app information!');
			return;
		}
		var newValue = Math.round(app.usage.mem / 1024 / 1024);
		if (this.__lastRamUsage != newValue) {
			this.__lastRamUsage = newValue;
			this.Log.Log('RAM: ', newValue, ' MB (', app.usage.mem, ')');
			if (newValue >= 30) {
				this.Log.Warn('Detected high RAM consumption! Trying to force a garbage collect..');
				this.__forceGC();
			}
		}
	}

	async __forceGC() {
		if (global.gc) {
			try {
				global.gc();
			}
			catch (err) {
				this.Log.Error('gobal.gc() failed:', err);
			}
		} else {
			this.Log.Warn('No GC hook! --expose-gc is not set!');
		}
	}

	/**
	 * Application Init.
	 */
	async onInit() {
		this.Log = new Logger('LIFX LAN APP');
		this.Log.Log('Starting up..');
		this.AppRegistrationEnabled = true;
		this.CEEMaxVersion = "1.0.0"; // Highest CE Editor version supported.
		this.__lastRamUsage = 0;
		// Cache for web api data.
		this.__webApiCache = {
			Zones: [],
			ZAge: null,
			Devices: [],
			DAge: null,
			MaxAge: 600000
		};
		// Initialize file store if required..
		if (!FileSystem.existsSync(`/userdata/effects`)) {
			this.Log.Log('Creating effects files store..');
			FileSystem.mkdirSync(`/userdata/effects`);
		}
		// Init core driver..
		this.LIFX_Manager = new LIFX_Manager();
		this.LIFX_Manager.IconsFolderLocation = '/device_icons/';
		setInterval(this.__ramMonitor.bind(this), 60000 * 10); // Every 10 minutes
		//this.LIFX_Manager.LogErrors = true;
		this.LIFX_Manager.on('new_device', this.__deviceDetected);
		// Set defaults if not present..
		var PollInterval = parseInt(this.homey.settings.get('statePollingInterval'));
		if (isNaN(PollInterval)) this.homey.settings.set('statePollingInterval', 10000);
		var Duration = parseInt(this.homey.settings.get('defaultTransitionDuration'));
		if (isNaN(Duration)) this.homey.settings.set('defaultTransitionDuration', 500);
		this.LIFX_Manager.PollingInterval = parseInt(this.homey.settings.get('statePollingInterval'));
		this.LIFX_Manager.DefaultTransitionDuration = parseInt(this.homey.settings.get('defaultTransitionDuration'));
		this.Log.Log('Dim Logic Behavior at Startup: ', this.logicBehavior);
		this.LIFX_Manager.OperationMode = this.logicBehavior;
		this.Log.Log('Kelvin Logic Behavior at Startup: ', this.kelvinBehavior);
		this.LIFX_Manager.KelvinMode = this.kelvinBehavior;
		this.LIFX_Effect_Instances = [];
		this.LIFX_Effect_CEInstances = [];
		if (!this.ceEditorKey || this.ceEditorKey == null || this.ceEditorKey.length < 8) {
			this.ceEditorKey = this.__getRandomHexId();
		}
		// Initialize the LIFX Cloud Control Library
		global.cloudApiClient = new LIFX_CloudApi(this.homey);
		this.initCloudFlowCards();
		this.initZoneFlowCards();
		this.initCommonFlowCards();
		this.initHevFlowCards();
		this.initMultizoneDeviceFlowCards();
		this.initDeviceFlowCards();
		this.initRelayFlowCards();
		this.initCustomEffectFlowCards();
		this.LIFX_Manager.Activate();
		this.Log.Log('Startup completed.');
		// Send important update infos to timeline..
		if (this.homey.settings.get('updInfo_0_10_0') == null) {
			await this.sendMsgToTimeline(this.homey.__('updateInfos.0_10_0'));
			this.homey.settings.set('updInfo_0_10_0', true);
		}
		/*if (this.homey.settings.get('updInfo_common') == null) {
			await this.sendMsgToTimeline(this.homey.__('updateInfos.common'));
			this.homey.settings.set('updInfo_common', true);
		}
		if (this.homey.settings.get('updInfo_1_0_0') == null) {
			await this.sendMsgToTimeline(this.homey.__('updateInfos.1_0_0'));
			this.homey.settings.set('updInfo_1_0_0', true);
		}*/
	}

	__cleanupEffectsList() {
		var cleaning = true;
		while (cleaning) {
			cleaning = false;
			for (var idx = 0; idx < this.homey.app.LIFX_Effect_Instances.length; idx++) {
				if (this.homey.app.LIFX_Effect_Instances[idx].e.Active === false) {
					cleaning = true;
					this.homey.app.LIFX_Effect_Instances.splice(idx, 1);
					break;
				}
			}
		}
	}
	//TODO: SDKv3 REWORK
	initCustomEffectFlowCards() {
		this.Log.Log('Registring Custom Effect Flowcards..');
		let self = this;
		// CE Effect cards
		let ceStopAny = this.homey.flow.getActionCard('homey_ce_stop_any')
			.registerRunListener(async args => {
				this.homey.app.Log.Log(`getActionCard->homey_ce_stop_any:`, args);
				if (args.stop_mode == 'ANY' || args.stop_mode == 'UCE') {
					while (this.homey.app.__stopAllCustomEffects() === false);
				}
				if (args.stop_mode == 'ANY' || args.stop_mode == 'BICE') {
					while (this.homey.app.__StopAllBuildinEffects() === false);
				}
				return Promise.resolve();
			});
		let ceUserStart = this.homey.flow.getActionCard('homey_zone_custom_user_effect')
			.registerRunListener(async args => {
				this.homey.app.Log.Log(`getActionCard->homey_zone_custom_user_effect:`, args);
				// Check license
				var regStatus = await this.homey.app.getAppRegistered();
				if (regStatus != 0) {
					return Promise.reject(this.homey.__('inApp.customEffects.featureNotRegistered'));
				}
				// Check CE is active already
				if (this.homey.app.__isCustomEffectRunning(args.the_effect.id) === true) {
					return Promise.reject(this.homey.__('inApp.customEffects.ceRunningAlready'));
				}
				var restoreDevices = true;
				if (args.restore_lights == 'NO') restoreDevices = false;
				if (this.homey.app.__startCustomEffect(args.the_effect.id, restoreDevices) === false) {
					return Promise.reject(this.homey.__('inApp.customEffects.ceLaunchError'));
				}
				return Promise.resolve();
			});
		ceUserStart.getArgument('the_effect')
			.registerAutocompleteListener(async query => {
				var installedCEs = this.homey.app.__getCustomEffectsIndex();
				installedCEs.forEach(element => {
					element.description = (element.loop === true) ? this.homey.__('inApp.customEffects.looped') : this.homey.__('inApp.customEffects.oneshot');
				});
				return Promise.resolve(installedCEs);
			});
		let ceUserStop = this.homey.flow.getActionCard('homey_zone_custom_user_effect_stop')
			.registerRunListener(async args => {
				this.homey.app.Log.Log(`getActionCard->homey_zone_custom_user_effect_stop:`, args);
				this.homey.app.__stopCustomEffect(args.the_effect.id);
				return Promise.resolve();
			});
		ceUserStop.getArgument('the_effect')
			.registerAutocompleteListener(async query => {
				var installedCEs = this.homey.app.__getCustomEffectsIndex();
				installedCEs.forEach(element => {
					element.description = (element.loop === true) ? this.homey.__('inApp.customEffects.looped') : this.homey.__('inApp.customEffects.oneshot');
				});
				return Promise.resolve(installedCEs);
			});
		let ceUserStatus = this.homey.flow.getConditionCard('homey_zone_is_custom_user_effect_active');
		ceUserStatus.registerRunListener((args, state) => {
			return Promise.resolve(this.homey.app.__isCustomEffectRunning(args.the_effect.id));
		});
		ceUserStatus.getArgument('the_effect')
			.registerAutocompleteListener(async query => {
				var installedCEs = this.homey.app.__getCustomEffectsIndex();
				installedCEs.forEach(element => {
					element.description = (element.loop === true) ? this.homey.__('inApp.customEffects.looped') : this.homey.__('inApp.customEffects.oneshot');
				});
				return Promise.resolve(installedCEs);
			});
		// Build-in effects for zones
		let cecRl = this.homey.flow.getActionCard('homey_zone_custom_effect')
			.registerRunListener(async args => {
				this.homey.app.Log.Log(`getActionCard->homey_zone_custom_effect:`, args);
				// Check LIFX_Effect_Instances
				var eAlready = false;
				this.homey.app.LIFX_Effect_Instances.forEach(knownEffect => {
					if (knownEffect.zid == args.the_zone.id && knownEffect.e.Active === true) eAlready = true;
				});
				if (eAlready === true) return Promise.reject(this.homey.__('inApp.customEffects.runningAlready'));
				// Run effect
				let include_subzones = false;
				if (args.include_subzones && args.include_subzones == 'NO') include_subzones = true;
				let targetedDevices = await this.homey.app.getDeviceOfZoneTree(args.the_zone, include_subzones);
				if (targetedDevices.length == 0) return Promise.reject(this.homey.__('inApp.customEffects.noDevices'));
				let zonesList = [];
				targetedDevices.forEach(function (targetDevice) {
					let lifxDevice = self.homey.app.LIFX_Manager.GetDeviceById(targetDevice.device_id);
					if (lifxDevice != null) {
						let zPerDev = [];
						zPerDev.push(lifxDevice);
						zonesList.push(zPerDev);
					}
				});
				let effect = new LIFX_Effect(args.the_effect.id, zonesList);
				if (args.restore_lights == 'NO') effect.RestoreLightsAfterEventEnds = false;
				effect.Start();
				this.homey.app.LIFX_Effect_Instances.push({
					id: args.the_effect.id,
					zid: args.the_zone.id,
					e: effect
				});
				effect.on('effect_ended', function () {
					effect.removeAllListeners();
					self.homey.app.__cleanupEffectsList();
				});
				return Promise.resolve();
			});
		cecRl.getArgument('the_zone')
			.registerAutocompleteListener(async query => { return this.homey.app.getAllZones().then(zones => { return zones; }); });
		cecRl.getArgument('the_effect')
			.registerAutocompleteListener(async query => {
				var eFiles = this.homey.app.LIFX_Manager.Effects.GetInstalledEffectsFiles();
				var menuEntries = [];
				eFiles.forEach(async element => {
					let effect = new LIFX_Effect(element, [], false);
					if (effect.RequiredZones == 1) {
						let new_entry = {
							name: effect.Name,
							description: (effect.Looped === true) ? this.homey.__('inApp.customEffects.looped') : this.homey.__('inApp.customEffects.oneshot'),
							id: element
						};
						menuEntries.push(new_entry);
					}
					effect = null;
				});
				return Promise.resolve(menuEntries);
			});
		let cecRlStop = this.homey.flow.getActionCard('homey_zone_custom_effect_stop')
			.registerRunListener(async args => {
				this.homey.app.Log.Log(`getActionCard->homey_zone_custom_effect_stop:`, args);
				this.homey.app.LIFX_Effect_Instances.forEach(knownEffect => {
					if (knownEffect.zid == args.the_zone.id && knownEffect.e.Active === true) knownEffect.e.Stop();
				});
				return Promise.resolve();
			});
		cecRlStop.getArgument('the_zone')
			.registerAutocompleteListener(async query => { return this.homey.app.getAllZones().then(zones => { return zones; }); });
		let Condition_Effect = this.homey.flow.getConditionCard('homey_zone_is_custom_effect_active');
		Condition_Effect.registerRunListener((args, state) => {
			var eAlready = false;
			this.homey.app.LIFX_Effect_Instances.forEach(knownEffect => {
				if (knownEffect.zid == args.the_zone.id && knownEffect.e.Active === true) eAlready = true;
			});
			return Promise.resolve(eAlready);
		});
		Condition_Effect.getArgument('the_zone')
			.registerAutocompleteListener(async query => { return this.homey.app.getAllZones().then(zones => { return zones; }); });
		this.Log.Log('Registering Custom Effect Flowcards completed.');
	}

	initRelayFlowCards() {
		this.Log.Log('Registring Relay Flowcards..');
		// General OnOff events
		this.Trigger_Relay = [];
		for (var rIdx = 0; rIdx < 4; rIdx++) {
			this.Trigger_Relay.push({
				on: this.homey.flow.getDeviceTriggerCard(`relay_${rIdx}_turned_on`),
				off: this.homey.flow.getDeviceTriggerCard(`relay_${rIdx}_turned_off`)
			});
		}
		//TODO: Relay: dim change events
		// Relay Action cards
		let Action_Relay_Switch = this.homey.flow.getActionCard('set_relay');
		Action_Relay_Switch.registerRunListener((args, state) => {
			if (args.my_device.LIFX_Device == null) return Promise.reject();
			var value = (args.cmd == 'on') ? true : false;
			var relayOldState = (args.my_device.LIFX_Device.GetRelayStatus(args.relay.value) > 0) ? true : false;
			if (value != relayOldState) {
				this.homey.app.onCapabilityRelay_FireTrigger(args.my_device, args.relay.value, value);
			}
			args.my_device.LIFX_Device.SetRelayStatus(args.relay.value, value);
			return Promise.resolve();
		});
		Action_Relay_Switch.getArgument('relay')
			.registerAutocompleteListener(async (query, args) => {
				if (args.my_device.LIFX_Device == null) return Promise.resolve([]);
				let result = [];
				for (var rIdx = 0; rIdx < args.my_device.LIFX_Device.NumberOfRelays; rIdx++) {
					result.push({
						name: `#${rIdx + 1}`,
						value: rIdx,
						id: rIdx
					});
				}
				return Promise.resolve(result);
			});
		// Relay condition cards
		let Condition_Relay = this.homey.flow.getConditionCard('state_check_relay');
		Condition_Relay.registerRunListener((args, state) => {
			if (args.my_device.LIFX_Device == null) return Promise.reject();
			var result = (args.my_device.LIFX_Device.GetRelayStatus(args.relay.value) > 0) ? true : false;
			return Promise.resolve(result);
		});
		Condition_Relay.getArgument('relay')
			.registerAutocompleteListener(async (query, args) => {
				if (args.my_device.LIFX_Device == null) return Promise.resolve([]);
				let result = [];
				for (var rIdx = 0; rIdx < args.my_device.LIFX_Device.NumberOfRelays; rIdx++) {
					result.push({
						name: `#${rIdx + 1}`,
						value: rIdx,
						id: rIdx
					});
				}
				return Promise.resolve(result);
			});
		this.Log.Log('Registering Relay Flowcards completed.');
	}

	/**
	 * Registers all FlowCards using the Cloud API client.
	 */
	initCloudFlowCards() {
		this.Log.Log('Registring Scene & Tile Cloud Flowcards..');
		// Scene Cards
		this.homey.flow.getActionCard('activate_scene')
			.registerRunListener(async args => {
				this.homey.app.Log.Log('getActionCard->activate_scene:', this.homey.app.sanitzeDeviceDataForLogging(args));
				let ignoreList = [];
				if (args.turn_on == "No") {
					ignoreList.push("power");
				}
				if (args.ignore_infrared == "Yes") {
					ignoreList.push("infrared");
				}
				let api = global.cloudApiClient; // developer token variant
				if (typeof args.duration === 'number')
					args.duration /= 1000;
				return api.setScene({
					sceneUuid: args.scene.uuid,
					ignoreList: ignoreList,
					duration: args.duration
				});
			})
			.getArgument('scene')
			.registerAutocompleteListener(async query => {
				let api = global.cloudApiClient; // developer token variant
				return api.getScenes().then(scenes => {
					return scenes.map(scene => {
						return {
							name: scene.name,
							uuid: scene.uuid
						}
					})
				});
			});

		this.homey.flow.getActionCard('deactivate_scene')
			.registerRunListener(async args => {
				this.homey.app.Log.Log('getActionCard->deactivate_scene:', this.homey.app.sanitzeDeviceDataForLogging(args));
				let ignoreList = [
					"infrared",
					"hue",
					"intensity",
					"saturation",
					"kelvin"
				];
				let api = global.cloudApiClient; // developer token variant
				if (typeof args.duration === 'number')
					args.duration /= 1000;
				let stateOverride = {
					power: "off",
					duration: args.duration,
					fast: true
				};
				return api.setSceneOverride({
					sceneUuid: args.scene.uuid,
					ignoreList: ignoreList,
					state: stateOverride,
					duration: args.duration
				});
			})
			.getArgument('scene')
			.registerAutocompleteListener(async query => {
				let api = global.cloudApiClient; // developer token variant
				return api.getScenes().then(scenes => {
					return scenes.map(scene => {
						return {
							name: scene.name,
							uuid: scene.uuid
						}
					})
				});
			});

		this.homey.flow.getActionCard('activate_lights_in_scene')
			.registerRunListener(async args => {
				this.homey.app.Log.Log('getActionCard->activate_lights_in_scene:', this.homey.app.sanitzeDeviceDataForLogging(args));
				let ignoreList = [
					"infrared",
					"hue",
					"intensity",
					"saturation",
					"kelvin"
				];
				let api = global.cloudApiClient; // developer token variant
				if (typeof args.duration === 'number')
					args.duration /= 1000;
				let stateOverride = {
					power: "on",
					duration: args.duration,
					fast: true
				};
				return api.setSceneOverride({
					sceneUuid: args.scene.uuid,
					ignoreList: ignoreList,
					state: stateOverride,
					duration: args.duration
				});
			})
			.getArgument('scene')
			.registerAutocompleteListener(async query => {
				let api = global.cloudApiClient; // developer token variant
				return api.getScenes().then(scenes => {
					return scenes.map(scene => {
						return {
							name: scene.name,
							uuid: scene.uuid
						}
					})
				});
			});

		this.homey.flow.getActionCard('set_lights_color_in_scene')
			.registerRunListener(async args => {
				this.homey.app.Log.Log('getActionCard->set_lights_color_in_scene:', this.homey.app.sanitzeDeviceDataForLogging(args));
				let ignoreList = [
					"infrared"
				];
				if (args.turn_on == "No") {
					ignoreList.push("power");
				}
				let api = global.cloudApiClient; // developer token variant
				if (typeof args.duration === 'number')
					args.duration /= 1000;
				let stateOverride = {
					color: args.light_color,
					duration: args.duration,
					fast: true
				};
				return api.setSceneOverride({
					sceneUuid: args.scene.uuid,
					ignoreList: ignoreList,
					state: stateOverride,
					duration: args.duration
				});
			})
			.getArgument('scene')
			.registerAutocompleteListener(async query => {
				let api = global.cloudApiClient; // developer token variant
				return api.getScenes().then(scenes => {
					return scenes.map(scene => {
						return {
							name: scene.name,
							uuid: scene.uuid
						}
					})
				});
			});

		this.homey.flow.getActionCard('set_lights_brightness_in_scene')
			.registerRunListener(async args => {
				this.homey.app.Log.Log('getActionCard->set_lights_brightness_in_scene:', this.homey.app.sanitzeDeviceDataForLogging(args));
				let ignoreList = [
					"infrared",
					"hue",
					"intensity",
					"saturation",
					"kelvin"
				];
				if (args.turn_on == "No") {
					ignoreList.push("power");
				}
				let api = global.cloudApiClient; // developer token variant
				if (typeof args.duration === 'number')
					args.duration /= 1000;
				let stateOverride = {
					brightness: args.new_brightness,
					duration: args.duration,
					fast: true
				};
				return api.setSceneOverride({
					sceneUuid: args.scene.uuid,
					ignoreList: ignoreList,
					state: stateOverride,
					duration: args.duration
				});
			})
			.getArgument('scene')
			.registerAutocompleteListener(async query => {
				let api = global.cloudApiClient; // developer token variant
				return api.getScenes().then(scenes => {
					return scenes.map(scene => {
						return {
							name: scene.name,
							uuid: scene.uuid
						}
					})
				});
			});

		this.homey.flow.getActionCard('activate_tile_flame')
			.registerRunListener(async args => {
				let cleanArgs = this.homey.app.sanitzeDeviceDataForLogging(args);
				this.homey.app.Log.Log('getActionCard->activate_tile_flame:', cleanArgs);
				let api = global.cloudApiClient; // developer token variant
				return api.setEffectFlame({
					device_id: cleanArgs.Device.Data.id,
					period: args.effect_speed,
					power_on: (args.turn_on == "Yes") ? true : false
				});
			});

		this.homey.flow.getActionCard('activate_tile_morph')
			.registerRunListener(async args => {
				let cleanArgs = this.homey.app.sanitzeDeviceDataForLogging(args);
				this.homey.app.Log.Log('getActionCard->activate_tile_morph:', cleanArgs);
				let api = global.cloudApiClient; // developer token variant
				return api.setEffectMorph({
					device_id: cleanArgs.Device.Data.id,
					period: args.effect_speed,
					palette: [args.effect_color1, args.effect_color2, args.effect_color3, args.effect_color4, args.effect_color5, args.effect_color6, args.effect_color7],
					power_on: (args.turn_on == "Yes") ? true : false
				});
			});

		this.homey.flow.getActionCard('stop_chain_effect')
			.registerRunListener(async args => {
				let cleanArgs = this.homey.app.sanitzeDeviceDataForLogging(args);
				this.homey.app.Log.Log('getActionCard->stop_chain_effect:', cleanArgs);
				let api = global.cloudApiClient; // developer token variant
				return api.stopChainDeviceEffect({
					device_id: cleanArgs.Device.Data.id,
					power_off: (args.turn_off == "Yes") ? true : false
				});
			});
		this.Log.Log('Registering Scene & Tile Cloud Flowcards completed.');
	} // initCloudFlowCards

	/**
	 * Generic Zone Command handler.
	 * @param {string} cmd Command name.
	 * @param {string} cardName Name of the flowcard for diagnostic purposes.
	 * @param {*} args Flowcard arguements.
	 */
	async ZoneCommand(cmd, cardName, args) {
		let self = this;
		this.homey.app.Log.Log(`getActionCard->${cardName}:`, args);
		// Handle Duration
		let duration = this.homey.app.defaultTransitionDuration;
		if (args.duration != null) duration = args.duration;
		// Gather devices to target
		let include_subzones = false;
		if (args.include_subzones && args.include_subzones == 'NO') include_subzones = true;
		let targetedDevices = await this.homey.app.getDeviceOfZoneTree(args.the_zone, include_subzones);
		// Set global random duration if required.
		if (args.effect_duration_mode && args.effect_duration_mode == 'RANDOM_ALL') {
			duration = this.homey.app.LIFX_Manager.GetRandomNumber(args.effect_duration_min, args.effect_duration_max, false);
		}
		// Pre process color effects
		let rndHue = null;
		let rndSat = null;
		let dataSet = null;
		if (cmd == 'setColorRandom') {
			rndHue = this.homey.app.LIFX_Manager.GetRandomNumber(0, 360, false);
			rndSat = this.homey.app.LIFX_Manager.GetRandomNumber(1, 100, false);
		} else if (cmd == 'setColorRandomAdv') {
			dataSet = this.homey.app.LIFX_Manager.GetRandomColorDataset(args.effect_hue_min, args.effect_hue_max, args.effect_sat_min, args.effect_sat_max, args.effect_dim_min, args.effect_dim_max, args.effect_duration_min, args.effect_duration_max);
		}
		// Pre process effect commands
		let packetObj = null;
		if (cmd == 'playEffectGlow' || cmd == 'playEffectSaw') {
			packetObj = this.homey.app.LIFX_Manager.API_CreateWaveFormPacket(args.effect_color, args.effect_length, args.repeats, args.effect_mode, 0.5, true);
		} else if (cmd == 'playEffectPulse') {
			var isTrans = true;
			if (args.effect_trans == "No") isTrans = false;
			packetObj = this.homey.app.LIFX_Manager.API_CreateWaveFormPacket(args.effect_color, args.effect_length, args.repeats, 'PULSE', args.effect_skew, isTrans);
		}
		// Iterate devices
		targetedDevices.forEach(async function (targetDevice) {
			let lifxDevice = self.homey.app.LIFX_Manager.GetDeviceById(targetDevice.device_id);
			if (lifxDevice != null) {
				if (cmd == 'turnOn') {
					lifxDevice.SetOnOff(true, duration);
				} else if (cmd == 'turnOff') {
					lifxDevice.SetOnOff(false, duration);
				} else if (cmd == 'setColorByHex') {
					if (lifxDevice.SupportsColor === true) lifxDevice.SetLightColorByHex(args.the_color, duration);
				} else if (cmd == 'setColorByHexCode') {
					if (lifxDevice.SupportsColor === true) lifxDevice.SetLightColorByHex(args.hex_code, duration);
				} else if (cmd == 'setDimLevel') {
					lifxDevice.SetDimLevel(args.new_dim / 100, duration);
				} else if (cmd == 'setRelDimLevel') {
					let newLevel = lifxDevice.DimLevel + (args.new_rel_dim / 100);
					if (newLevel < 0.0) newLevel = 0;
					if (newLevel > 1.0) newLevel = 1;
					lifxDevice.SetDimLevel(newLevel, duration);
				} else if (cmd == 'setTemp') {
					if (lifxDevice.SupportsTemperature === true) {
						lifxDevice.ColorMode = false;
						lifxDevice.SetLightTemperature(args.new_temp / 100, duration);
					}
				} else if (cmd == 'playEffectGlow' || cmd == 'playEffectSaw' || cmd == 'playEffectPulse') {
					if (lifxDevice.SupportsColor === true) self.homey.app.LIFX_Manager.API_SendCommandPacket(lifxDevice, packetObj);
				} else if (cmd == 'setColorRandom' || cmd == 'setColorRandomAdv') {
					if (lifxDevice.SupportsColor === true) {
						if (lifxDevice.SupportsMultizone === true && args.ignore_multizone == 'YES') return;
						if (lifxDevice.SupportsChain === true && args.ignore_chain == 'YES') return;
						// ReSet random duration if required.
						if (args.effect_duration_mode == 'RANDOM_SINGLE') {
							duration = self.homey.app.LIFX_Manager.GetRandomNumber(args.effect_duration_min, args.effect_duration_max, false);
						}
						// ReGenerate random color if required.
						if (cmd == 'setColorRandom') {
							if (args.effect_mode == 'SINGLE') {
								rndHue = self.homey.app.LIFX_Manager.GetRandomNumber(0, 360, false);
								rndSat = self.homey.app.LIFX_Manager.GetRandomNumber(1, 100, false);
							}
							lifxDevice.SetLightColor(rndHue, duration);
							lifxDevice.SetLightSaturation(rndSat / 100, duration);
						} else if (cmd == 'setColorRandomAdv') {
							if (args.effect_mode == 'SINGLE') {
								dataSet = self.homey.app.LIFX_Manager.GetRandomColorDataset(args.effect_hue_min, args.effect_hue_max, args.effect_sat_min, args.effect_sat_max, args.effect_dim_min, args.effect_dim_max, args.effect_duration_min, args.effect_duration_max);
							}
							lifxDevice.SetLightColor(dataSet.hue, duration);
							lifxDevice.SetLightSaturation(dataSet.sat / 100, duration);
							lifxDevice.SetDimLevel(dataSet.dim / 100, duration);
						}
					}
				}
			}
		});
		return Promise.resolve(true);
	}
	/**
	 * Registers all FlowCards using Homey Zones API.
	 */
	initZoneFlowCards() {
		this.Log.Log('Registring Homey Zones Flowcards..');
		this.homey.flow.getActionCard('homey_zone_turn_on')
			.registerRunListener(async args => { return this.homey.app.ZoneCommand('turnOn', 'homey_zone_turn_on', args); })
			.getArgument('the_zone')
			.registerAutocompleteListener(async query => { return this.homey.app.getAllZones().then(zones => { return zones; }); });
		this.homey.flow.getActionCard('homey_zone_turn_on_gen2')
			.registerRunListener(async args => { return this.homey.app.ZoneCommand('turnOn', 'homey_zone_turn_on_gen2', args); })
			.getArgument('the_zone')
			.registerAutocompleteListener(async query => { return this.homey.app.getAllZones().then(zones => { return zones; }); });
		this.homey.flow.getActionCard('homey_zone_turn_off')
			.registerRunListener(async args => { return this.homey.app.ZoneCommand('turnOff', 'homey_zone_turn_off', args); })
			.getArgument('the_zone')
			.registerAutocompleteListener(async query => { return this.homey.app.getAllZones().then(zones => { return zones; }); });
		this.homey.flow.getActionCard('homey_zone_turn_off_gen2')
			.registerRunListener(async args => { return this.homey.app.ZoneCommand('turnOff', 'homey_zone_turn_off_gen2', args); })
			.getArgument('the_zone')
			.registerAutocompleteListener(async query => { return this.homey.app.getAllZones().then(zones => { return zones; }); });
		this.homey.flow.getActionCard('set_homey_zone_color')
			.registerRunListener(async args => { return this.homey.app.ZoneCommand('setColorByHex', 'set_homey_zone_color', args); })
			.getArgument('the_zone')
			.registerAutocompleteListener(async query => { return this.homey.app.getAllZones().then(zones => { return zones; }); });
		this.homey.flow.getActionCard('set_homey_zone_color_gen2')
			.registerRunListener(async args => { return this.homey.app.ZoneCommand('setColorByHex', 'set_homey_zone_color_gen2', args); })
			.getArgument('the_zone')
			.registerAutocompleteListener(async query => { return this.homey.app.getAllZones().then(zones => { return zones; }); });
		this.homey.flow.getActionCard('set_homey_zone_color_random')
			.registerRunListener(async args => { return this.homey.app.ZoneCommand('setColorRandom', 'set_homey_zone_color_random', args); })
			.getArgument('the_zone')
			.registerAutocompleteListener(async query => { return this.homey.app.getAllZones().then(zones => { return zones; }); });
		this.homey.flow.getActionCard('set_homey_zone_color_random_gen2')
			.registerRunListener(async args => { return this.homey.app.ZoneCommand('setColorRandom', 'set_homey_zone_color_random_gen2', args); })
			.getArgument('the_zone')
			.registerAutocompleteListener(async query => { return this.homey.app.getAllZones().then(zones => { return zones; }); });
		this.homey.flow.getActionCard('set_homey_zone_color_random_advanced')
			.registerRunListener(async args => { return this.homey.app.ZoneCommand('setColorRandomAdv', 'set_homey_zone_color_random_advanced', args); })
			.getArgument('the_zone')
			.registerAutocompleteListener(async query => { return this.homey.app.getAllZones().then(zones => { return zones; }); });
		this.homey.flow.getActionCard('set_homey_zone_color_random_advanced_gen2')
			.registerRunListener(async args => { return this.homey.app.ZoneCommand('setColorRandomAdv', 'set_homey_zone_color_random_advanced_gen2', args); })
			.getArgument('the_zone')
			.registerAutocompleteListener(async query => { return this.homey.app.getAllZones().then(zones => { return zones; }); });
		this.homey.flow.getActionCard('set_homey_zone_hex_color')
			.registerRunListener(async args => { return this.homey.app.ZoneCommand('setColorByHexCode', 'set_homey_zone_hex_color', args); })
			.getArgument('the_zone')
			.registerAutocompleteListener(async query => { return this.homey.app.getAllZones().then(zones => { return zones; }); });
		this.homey.flow.getActionCard('set_homey_zone_hex_color_gen2')
			.registerRunListener(async args => { return this.homey.app.ZoneCommand('setColorByHexCode', 'set_homey_zone_hex_color_gen2', args); })
			.getArgument('the_zone')
			.registerAutocompleteListener(async query => { return this.homey.app.getAllZones().then(zones => { return zones; }); });
		this.homey.flow.getActionCard('set_homey_zone_dim')
			.registerRunListener(async args => { return this.homey.app.ZoneCommand('setDimLevel', 'set_homey_zone_dim', args); })
			.getArgument('the_zone')
			.registerAutocompleteListener(async query => { return this.homey.app.getAllZones().then(zones => { return zones; }); });
		this.homey.flow.getActionCard('set_homey_zone_dim_gen2')
			.registerRunListener(async args => { return this.homey.app.ZoneCommand('setDimLevel', 'set_homey_zone_dim_gen2', args); })
			.getArgument('the_zone')
			.registerAutocompleteListener(async query => { return this.homey.app.getAllZones().then(zones => { return zones; }); });
		this.homey.flow.getActionCard('set_homey_zone_rel_dim')
			.registerRunListener(async args => { return this.homey.app.ZoneCommand('setRelDimLevel', 'set_homey_zone_rel_dim', args); })
			.getArgument('the_zone')
			.registerAutocompleteListener(async query => { return this.homey.app.getAllZones().then(zones => { return zones; }); });
		this.homey.flow.getActionCard('set_homey_zone_rel_dim_gen2')
			.registerRunListener(async args => { return this.homey.app.ZoneCommand('setRelDimLevel', 'set_homey_zone_rel_dim_gen2', args); })
			.getArgument('the_zone')
			.registerAutocompleteListener(async query => { return this.homey.app.getAllZones().then(zones => { return zones; }); });
		this.homey.flow.getActionCard('set_homey_zone_temp')
			.registerRunListener(async args => { return this.homey.app.ZoneCommand('setTemp', 'set_homey_zone_temp', args); })
			.getArgument('the_zone')
			.registerAutocompleteListener(async query => { return this.homey.app.getAllZones().then(zones => { return zones; }); });
		this.homey.flow.getActionCard('set_homey_zone_temp_gen2')
			.registerRunListener(async args => { return this.homey.app.ZoneCommand('setTemp', 'set_homey_zone_temp_gen2', args); })
			.getArgument('the_zone')
			.registerAutocompleteListener(async query => { return this.homey.app.getAllZones().then(zones => { return zones; }); });
		this.homey.flow.getActionCard('play_effect_glow_zone')
			.registerRunListener(async args => { return this.homey.app.ZoneCommand('playEffectGlow', 'play_effect_glow_zone', args); })
			.getArgument('the_zone')
			.registerAutocompleteListener(async query => { return this.homey.app.getAllZones().then(zones => { return zones; }); });
		this.homey.flow.getActionCard('play_effect_glow_zone_gen2')
			.registerRunListener(async args => { return this.homey.app.ZoneCommand('playEffectGlow', 'play_effect_glow_zone_gen2', args); })
			.getArgument('the_zone')
			.registerAutocompleteListener(async query => { return this.homey.app.getAllZones().then(zones => { return zones; }); });
		this.homey.flow.getActionCard('play_effect_saw_zone')
			.registerRunListener(async args => { return this.homey.app.ZoneCommand('playEffectSaw', 'play_effect_saw_zone', args); })
			.getArgument('the_zone')
			.registerAutocompleteListener(async query => { return this.homey.app.getAllZones().then(zones => { return zones; }); });
		this.homey.flow.getActionCard('play_effect_saw_zone_gen2')
			.registerRunListener(async args => { return this.homey.app.ZoneCommand('playEffectSaw', 'play_effect_saw_zone_gen2', args); })
			.getArgument('the_zone')
			.registerAutocompleteListener(async query => { return this.homey.app.getAllZones().then(zones => { return zones; }); });
		this.homey.flow.getActionCard('play_effect_pulse_zone')
			.registerRunListener(async args => { return this.homey.app.ZoneCommand('playEffectPulse', 'play_effect_pulse_zone', args); })
			.getArgument('the_zone')
			.registerAutocompleteListener(async query => { return this.homey.app.getAllZones().then(zones => { return zones; }); });
		this.homey.flow.getActionCard('play_effect_pulse_zone_gen2')
			.registerRunListener(async args => { return this.homey.app.ZoneCommand('playEffectPulse', 'play_effect_pulse_zone_gen2', args); })
			.getArgument('the_zone')
			.registerAutocompleteListener(async query => { return this.homey.app.getAllZones().then(zones => { return zones; }); });
		this.Log.Log('Registering Homey Zones Flowcards completed.');
	} // initZoneFlowCards

	/**
	 * Register HEV specific flowcards.
	 */
	initHevFlowCards() {
		this.Log.Log('Registring HEV Device Flowcards..');
		let action_device_set_hev_cycle = this.homey.flow.getActionCard('start_clean_cycle');
		action_device_set_hev_cycle.registerRunListener(async (args, state) => {
			this.homey.app.Log.Log('getActionCard->start_clean_cycle: ', this.homey.app.sanitzeDeviceDataForLogging(args));
			let deviceData = args.my_device.getData();
			let targetDevice = this.homey.app.LIFX_Manager.GetDeviceById(deviceData.id);
			if (args.duration && args.duration != null) {
				targetDevice.SetHevActive(args.duration / 1000); // ms to s
			} else {
				targetDevice.HevActive = true;
			}
			return Promise.resolve(true);
		});
		let action_device_stop_hev_cycle = this.homey.flow.getActionCard('abort_clean_cycle');
		action_device_stop_hev_cycle.registerRunListener(async (args, state) => {
			this.homey.app.Log.Log('getActionCard->abort_clean_cycle: ', this.homey.app.sanitzeDeviceDataForLogging(args));
			let deviceData = args.my_device.getData();
			let targetDevice = this.homey.app.LIFX_Manager.GetDeviceById(deviceData.id);
			targetDevice.HevActive = false;
			return Promise.resolve(true);
		});
		this.Trigger_DeviceHevStatusChanged = this.homey.flow.getDeviceTriggerCard('hev_status_changed');
		this.Trigger_DeviceHevStatusChangedHr = this.homey.flow.getDeviceTriggerCard('hev_status_changed_hr');
		this.Trigger_DeviceHevProgressUpdate = this.homey.flow.getDeviceTriggerCard('hev_progress_update');
		let hevActive = this.homey.flow.getConditionCard('state_hev_active');
		hevActive.registerRunListener((args, state) => {
			let deviceData = args.my_device.getData();
			let targetDevice = this.homey.app.LIFX_Manager.GetDeviceById(deviceData.id);
			return Promise.resolve((targetDevice.HevActive));
		});
	}

	/**
	   * Registers all common device FlowCards.
	*/
	initCommonFlowCards() {
		this.Log.Log('Registring Common Device Flowcards..');
		let self = this;
		let trigger_device_gone = this.homey.flow.getTriggerCard('device_gone');
		let trigger_device_back = this.homey.flow.getTriggerCard('device_back');
		this.Trigger_DeviceGone = this.homey.flow.getDeviceTriggerCard('specific_device_gone');
		this.Trigger_DeviceBack = this.homey.flow.getDeviceTriggerCard('specific_device_back');
		// Register global device on-/offline events
		this.LIFX_Manager.on('device_offline', function (lifx_device) {
			self.homey.app.Log.Log('Device went offline: ', lifx_device.DeviceID, ' - ', lifx_device.Name);
			let trigger_device_tokens = {
				'device_label': lifx_device.Name
			};
			trigger_device_gone.trigger(trigger_device_tokens)
				.then(() => {
					self.homey.app.Log.Log("Fired trigger device_gone for ", lifx_device.Name);
				})
				.catch(err => {
					self.homey.app.Log.Error(err);
				})
		});
		this.LIFX_Manager.on('device_online', function (lifx_device) {
			self.homey.app.Log.Log('Device came online: ', lifx_device.DeviceID, ' - ', lifx_device.Name);
			let trigger_device_tokens = {
				'device_label': lifx_device.Name
			};
			trigger_device_back.trigger(trigger_device_tokens)
				.then(() => {
					self.homey.app.Log.Log("Fired trigger device_back for ", lifx_device.Name);
				})
				.catch(err => {
					self.homey.app.Log.Error(err);
				})
		});
	} // initCommonFlowCards

	async multiZoneDeviceShowProgress(args) {
		let duration = this.homey.app.defaultTransitionDuration;
		var dir = 'AWAY';
		if (args.direction && args.direction != null) dir = args.direction;
		if (args.duration && args.duration != null) duration = args.duration;
		if (args.progress_percentage > 100) args.progress_percentage = 100;
		if (args.progress_percentage < 0) args.progress_percentage = 0;
		let deviceData = args.my_device.getData();
		let targetDevice = this.homey.app.LIFX_Manager.GetDeviceById(deviceData.id);
		try {
			let progressOnDevice = 0;
			if (dir == 'AWAY') {
				progressOnDevice = Math.floor(this.homey.app.LIFX_Manager.MapScale(0, 100, args.zone_start, (args.zone_start + args.zone_length - 1), args.progress_percentage));
			} else {
				progressOnDevice = Math.floor(this.homey.app.LIFX_Manager.MapScale(100, 0, args.zone_start, (args.zone_start + args.zone_length - 1), args.progress_percentage));
			}
			// paint front
			let colorData = this.homey.app.LIFX_Manager.__getColorObjectFromHex(args.color_front, true);
			if (args.progress_percentage > 0) {
				if (dir == 'AWAY') {
					this.homey.app.LIFX_Manager.API_SetMultiZone(targetDevice, args.zone_start, (args.progress_percentage < 100) ? progressOnDevice - 1 : progressOnDevice, colorData.hue, colorData.saturation, colorData.brightness, 3500, duration, true);
				} else {
					this.homey.app.LIFX_Manager.API_SetMultiZone(targetDevice, (args.progress_percentage < 100) ? progressOnDevice + 1 : progressOnDevice, (args.zone_start + args.zone_length), colorData.hue, colorData.saturation, colorData.brightness, 3500, duration, true);
				}
			}
			// paint digit
			if (args.progress_percentage != 100) {
				colorData = this.homey.app.LIFX_Manager.__getColorObjectFromHex(args.color_digit, true);
				if (dir == 'AWAY') {
					this.homey.app.LIFX_Manager.API_SetMultiZone(targetDevice, progressOnDevice, progressOnDevice, colorData.hue, colorData.saturation, colorData.brightness, 3500, duration, true);
				} else {
					this.homey.app.LIFX_Manager.API_SetMultiZone(targetDevice, progressOnDevice, progressOnDevice, colorData.hue, colorData.saturation, colorData.brightness, 3500, duration, true);
				}
			}
			// paint back
			colorData = this.homey.app.LIFX_Manager.__getColorObjectFromHex(args.color_back, true);
			if (args.progress_percentage < 100) {
				if (dir == 'AWAY') {
					this.homey.app.LIFX_Manager.API_SetMultiZone(targetDevice, progressOnDevice + 1, (args.zone_start + args.zone_length - 1), colorData.hue, colorData.saturation, colorData.brightness, 3500, duration, true);
				} else {
					this.homey.app.LIFX_Manager.API_SetMultiZone(targetDevice, args.zone_start, progressOnDevice - 1, colorData.hue, colorData.saturation, colorData.brightness, 3500, duration, true);
				}
			}
		}
		catch (err) {
			if (err) {
				this.homey.app.Log.Error(targetDevice.Name, ' multiZoneDeviceShowProgress error:', err);
			}
			return Promise.reject(err);
		}
		return Promise.resolve(true);
	}

	/**
	   * Registers all common device FlowCards.
	*/
	initMultizoneDeviceFlowCards() {
		this.Log.Log('Registring Multizone Device Flowcards..');
		let action_device_set_mutlizone = this.homey.flow.getActionCard('set_multizone');
		action_device_set_mutlizone.registerRunListener(async (args, state) => {
			this.homey.app.Log.Log('getActionCard->set_multizone: ', this.homey.app.sanitzeDeviceDataForLogging(args));
			var duration = this.homey.app.defaultTransitionDuration;
			if (args.duration != null) duration = args.duration;
			var zoneItems = args.zone_code.split(";");
			var indexRunner = args.start_index;
			let deviceData = args.my_device.getData();
			let targetDevice = this.homey.app.LIFX_Manager.GetDeviceById(deviceData.id);
			for (var itemNow = 0; itemNow < zoneItems.length; itemNow++) {
				var zoneItem = zoneItems[itemNow].split(",");
				if (zoneItem.length != 1 && zoneItem.length != 4) {
					throw new Error(this.homey.__('inAppErrors.zoneCodeError'));
				}
				if (zoneItem.length == 1) {
					// hex code mode
					let colorData = this.homey.app.LIFX_Manager.__getColorObjectFromHex(zoneItem[0], true);
					this.homey.app.LIFX_Manager.API_SetMultiZone(targetDevice, indexRunner, indexRunner, colorData.hue, colorData.saturation, colorData.brightness, 3500, duration, itemNow == (zoneItems.length - 1) && args.apply == "Yes");
				} else {
					// HSBK mode
					this.homey.app.LIFX_Manager.API_SetMultiZone(targetDevice, indexRunner, indexRunner, parseInt(zoneItem[0]), parseInt(zoneItem[1]), parseInt(zoneItem[2]), parseInt(zoneItem[3]), duration, itemNow == (zoneItems.length - 1) && args.apply == "Yes");
				}
				indexRunner++;
			}
			return Promise.resolve(true);
		});
		// Multizone random
		let action_device_set_multizone_random_colors = this.homey.flow.getActionCard('set_multizone_random_colors');
		action_device_set_multizone_random_colors.registerRunListener(async (args, state) => {
			this.homey.app.Log.Log('getActionCard->set_multizone_random_colors: ', this.homey.app.sanitzeDeviceDataForLogging(args));
			let duration = this.homey.app.defaultTransitionDuration;
			if (args.duration != null) duration = args.duration;
			if (!args.zone_start) args.zone_start = 0;
			if (!args.zone_length) args.zone_length = 250;
			if (args.effect_duration_mode == 'RANDOM_ALL') {
				duration = this.homey.app.LIFX_Manager.GetRandomNumber(args.effect_duration_min, args.effect_duration_max, false);
			}
			let deviceData = args.my_device.getData();
			let targetDevice = this.homey.app.LIFX_Manager.GetDeviceById(deviceData.id);
			let dataSet = this.homey.app.LIFX_Manager.GetRandomColorDataset(args.effect_hue_min, args.effect_hue_max, args.effect_sat_min, args.effect_sat_max, args.effect_dim_min, args.effect_dim_max, args.effect_duration_min, args.effect_duration_max);
			try {
				for (var zoneIndex = args.zone_start; zoneIndex < (args.zone_start + args.zone_length); zoneIndex++) {
					// ReSet random duration if required.
					if (args.effect_duration_mode == 'RANDOM_SINGLE') {
						duration = this.homey.app.LIFX_Manager.GetRandomNumber(args.effect_duration_min, args.effect_duration_max, false);
					}
					// ReGenerate random color if required.
					if (args.effect_mode == 'SINGLE') {
						dataSet = this.homey.app.LIFX_Manager.GetRandomColorDataset(args.effect_hue_min, args.effect_hue_max, args.effect_sat_min, args.effect_sat_max, args.effect_dim_min, args.effect_dim_max, args.effect_duration_min, args.effect_duration_max);
					}
					this.homey.app.LIFX_Manager.API_SetMultiZone(targetDevice, zoneIndex, zoneIndex, dataSet.hue, dataSet.sat, dataSet.dim, 3500, duration, true);
				}
			}
			catch (err) {
				if (err) {
					this.homey.app.Log.Error(targetDevice.Name, ' getActionCard->set_multizone_random_colors:', err);
				}
				return Promise.resolve(false);
			}
			return Promise.resolve(true);
		});
		// Multizone progress
		// Multizone progress basic
		let action_device_set_multizone_progress = this.homey.flow.getActionCard('set_multizone_progress');
		action_device_set_multizone_progress.registerRunListener(async (args, state) => {
			this.homey.app.Log.Log('getActionCard->set_multizone_progress: ', this.homey.app.sanitzeDeviceDataForLogging(args));
			await this.homey.app.multiZoneDeviceShowProgress(args).then(() => {
				return Promise.resolve(true);
			}).catch((err) => {
				return Promise.reject(new Error(err));
			});
		});
		// Multizone valued progress
		let action_device_set_multizone_valued_progress = this.homey.flow.getActionCard('set_multizone_valued_progress');
		action_device_set_multizone_valued_progress.registerRunListener(async (args, state) => {
			this.homey.app.log('getActionCard->action_device_set_multizone_valued_progress: ', this.homey.app.sanitzeDeviceDataForLogging(args));
			args.progress_percentage = Math.floor(this.homey.app.LIFX_Manager.MapScale(args.progress_min, args.progress_max, 0, 100, args.progress_current));
			await this.homey.app.multiZoneDeviceShowProgress(args).then(() => {
				return Promise.resolve(true);
			}).catch((err) => {
				return Promise.reject(new Error(err));
			});
		});
		// Multizone basic
		let action_device_set_multizone_basic_6 = this.homey.flow.getActionCard('set_multizone_basic_6');
		action_device_set_multizone_basic_6.registerRunListener(async (args, state) => {
			this.homey.app.Log.Log('getActionCard->set_multizone_basic_6: ', this.homey.app.sanitzeDeviceDataForLogging(args));
			let duration = this.homey.app.defaultTransitionDuration;
			if (args.duration != null) duration = args.duration;
			let colors = [
				args.color1,
				args.color2,
				args.color3,
				args.color4,
				args.color5,
				args.color6
			];
			let deviceData = args.my_device.getData();
			let targetDevice = this.homey.app.LIFX_Manager.GetDeviceById(deviceData.id);
			try {
				for (var zoneIndex = 0; zoneIndex < targetDevice.ZonesCount; zoneIndex++) {
					let colorIndex = Math.floor(colors.length / targetDevice.ZonesCount * zoneIndex);
					let colorData = this.homey.app.LIFX_Manager.__getColorObjectFromHex(colors[colorIndex], true);
					this.homey.app.LIFX_Manager.API_SetMultiZone(targetDevice, zoneIndex, zoneIndex, colorData.hue, colorData.saturation, colorData.brightness, 3500, duration, zoneIndex == (targetDevice.ZonesCount - 1));
				}
			}
			catch (err) {
				if (err) {
					this.homey.app.Log.Error(targetDevice.Name, ' set_multizone_basic_6:', err);
				}
				return Promise.resolve(false);
			}
			return Promise.resolve(true);
		});
		let action_device_play_multizone_effect_move = this.homey.flow.getActionCard('play_multizone_effect_move');
		action_device_play_multizone_effect_move.registerRunListener(async (args, state) => {
			this.homey.app.Log.Log('getActionCard->play_multizone_effect_move: ', this.homey.app.sanitzeDeviceDataForLogging(args));
			let deviceData = args.my_device.getData();
			let targetDevice = this.homey.app.LIFX_Manager.GetDeviceById(deviceData.id);
			let apiPacket = this.homey.app.LIFX_Manager.API_CreateMultizoneEffectPacket('MOVE', args.direction, args.speed);
			this.homey.app.LIFX_Manager.API_SendCommandPacket(targetDevice, apiPacket);
			return Promise.resolve(true);
		});
		let action_device_stop_any_multizone_effect = this.homey.flow.getActionCard('stop_any_multizone_effect');
		action_device_stop_any_multizone_effect.registerRunListener(async (args, state) => {
			this.homey.app.Log.Log('getActionCard->stop_any_multizone_effect: ', this.homey.app.sanitzeDeviceDataForLogging(args));
			let deviceData = args.my_device.getData();
			let targetDevice = this.homey.app.LIFX_Manager.GetDeviceById(deviceData.id);
			let apiPacket = this.homey.app.LIFX_Manager.API_CreateMultizoneEffectStopPacket();
			this.homey.app.LIFX_Manager.API_SendCommandPacket(targetDevice, apiPacket);
			return Promise.resolve(true);
		});
		this.Log.Log('Registering Multizone Device Flowcards completed.');
	} // initMultizoneDeviceFlowCards

	/**
	 * Registers all common device FlowCards.
	*/
	initDeviceFlowCards() {
		this.Log.Log('Registering Standard Device Flowcards..');
		// RGB HEX Color Set Card
		let action_device_set_color_by_hex = this.homey.flow.getActionCard('set_color_by_hex');
		action_device_set_color_by_hex.registerRunListener(async (args, state) => {
			this.homey.app.Log.Log('getActionCard->set_color_by_hex: ', this.homey.app.sanitzeDeviceDataForLogging(args));
			var duration = this.homey.app.defaultTransitionDuration;
			if (args.duration != null) duration = args.duration;
			let deviceData = args.my_device.getData();
			let targetDevice = this.homey.app.LIFX_Manager.GetDeviceById(deviceData.id);
			try {
				targetDevice.SetLightColorByHex(args.hex_code.trim(), duration);
			}
			catch (err) {
				if (err) {
					this.homey.app.Log.Error(targetDevice.Name, ' set_color_by_hex:', err);
				}
				return Promise.resolve(false);
			}
			return Promise.resolve(true);
		});
		// Waveform effects see: https://lan.developer.lifx.com/docs/waveforms
		let action_device_play_effect_glow = this.homey.flow.getActionCard('play_effect_glow');
		action_device_play_effect_glow.registerRunListener(async (args, state) => {
			this.homey.app.Log.Log('getActionCard->play_effect_glow: ', this.homey.app.sanitzeDeviceDataForLogging(args));
			let deviceData = args.my_device.getData();
			let targetDevice = this.homey.app.LIFX_Manager.GetDeviceById(deviceData.id);
			let apiPacket = this.homey.app.LIFX_Manager.API_CreateWaveFormPacket(args.effect_color, args.effect_length, args.repeats, args.effect_mode, 0.5, true);
			this.homey.app.LIFX_Manager.API_SendCommandPacket(targetDevice, apiPacket);
			return Promise.resolve(true);
		});
		let action_device_play_effect_saw = this.homey.flow.getActionCard('play_effect_saw');
		action_device_play_effect_saw.registerRunListener(async (args, state) => {
			this.homey.app.Log.Log('getActionCard->play_effect_saw: ', this.homey.app.sanitzeDeviceDataForLogging(args));
			let deviceData = args.my_device.getData();
			let targetDevice = this.homey.app.LIFX_Manager.GetDeviceById(deviceData.id);
			var isTrans = true;
			if (args.effect_trans == "No") isTrans = false;
			let apiPacket = this.homey.app.LIFX_Manager.API_CreateWaveFormPacket(args.effect_color, args.effect_length, args.repeats, args.effect_mode, 0.5, isTrans);
			this.homey.app.LIFX_Manager.API_SendCommandPacket(targetDevice, apiPacket);
			return Promise.resolve(true);
		});
		let action_device_play_effect_pulse = this.homey.flow.getActionCard('play_effect_pulse');
		action_device_play_effect_pulse.registerRunListener(async (args, state) => {
			this.homey.app.Log.Log('getActionCard->play_effect_pulse: ', this.homey.app.sanitzeDeviceDataForLogging(args));
			let deviceData = args.my_device.getData();
			let targetDevice = this.homey.app.LIFX_Manager.GetDeviceById(deviceData.id);
			var isTrans = true;
			if (args.effect_trans == "No") isTrans = false;
			let apiPacket = this.homey.app.LIFX_Manager.API_CreateWaveFormPacket(args.effect_color, args.effect_length, args.repeats, 'PULSE', args.effect_skew, isTrans);
			this.homey.app.LIFX_Manager.API_SendCommandPacket(targetDevice, apiPacket);
			return Promise.resolve(true);
		});
		// Move to standard flowcards init?
		let action_device_set_max_ir = this.homey.flow.getActionCard('set_irMax');
		action_device_set_max_ir.registerRunListener(async (args, state) => {
			this.homey.app.Log.Log('getActionCard->set_irMax: ', this.homey.app.sanitzeDeviceDataForLogging(args));
			let deviceData = args.my_device.getData();
			let targetDevice = this.homey.app.LIFX_Manager.GetDeviceById(deviceData.id);
			targetDevice.Infrared = args.new_max_ir;
			return Promise.resolve(true);
		});
		//NOTE: Flux is not officially supported and disable from on v1+ for the time being.
		this.trigger_specific_device_flux_changed = this.homey.flow.getDeviceTriggerCard('specific_device_flux_changed');
		this.Log.Log('Registering Common Device Flowcards completed.');
		this.Log.Log('Registering Standard Device Flowcards completed.');
	} // initDeviceFlowCards

	// Manually load language file to come around restrictions of SDKv3
	getWebEditorLanguage() {
		var currentHomeyLang = this.homey.i18n.getLanguage();
		if (currentHomeyLang != 'de' && currentHomeyLang != 'en') currentHomeyLang = 'en';
		var languageScanPath = '';
		if (FileSystem.existsSync('/locales')) {
			languageScanPath = '/locales/';
		} else {
			languageScanPath = '/app/locales/';
		}
		var stringData = FileSystem.readFileSync(`${languageScanPath}${currentHomeyLang}.json`, 'utf-8');
		let langData = JSON.parse(stringData);
		return langData.ceExtension;
	}

	/**
	 * Returns the device list info for the app configuration page.
	*/
	getDevicesData() {
		let self = this;
		let devices = [];
		var seen = [];
		let lifxDrivers = self.homey.drivers.getDrivers();
		for (const [key, lifxDriver] of Object.entries(lifxDrivers)) {
			let lifxDevices = lifxDriver.getDevices();
			for (var i = 0; i < lifxDevices.length; i++) {
				let deviceData = lifxDevices[i].getData();
				let newDevice = {
					name: lifxDevices[i].getName(),
					data: {
						name: lifxDevices[i].getName(),
						ip: (lifxDevices[i].LIFX_Device != null) ? lifxDevices[i].LIFX_Device.DeviceIP : '?',
						wifi: (lifxDevices[i].LIFX_Device != null && lifxDevices[i].LIFX_Device.Online === true) ? self.homey.app.LIFX_Manager.GetWifiStrength(lifxDevices[i].LIFX_Device) : 0,
						product: lifxDevices[i].getSetting('productName'),
						productVersion: `${lifxDevices[i].getSetting('vendorId')}-${lifxDevices[i].getSetting('productId')}-${lifxDevices[i].getSetting('version')}`,
						id: deviceData.id,
						supColor: (lifxDevices[i].LIFX_Device != null) ? lifxDevices[i].LIFX_Device.SupportsColor : false
					}
				}
				seen.push(deviceData.id);
				devices.push(newDevice);
			}
		}
		self.homey.app.LIFX_Manager.KnownDevices.forEach(lifxDevice => {
			if (devices.includes(lifxDevice.DeviceID)) return;
			let newDevice = {
				name: lifxDevice.Name,
				data: {
					name: lifxDevice.Name,
					ip: lifxDevice.DeviceIP,
					wifi: (lifxDevice.Online === true) ? self.homey.app.LIFX_Manager.GetWifiStrength(lifxDevice) : 0,
					product: lifxDevice.ProductName,
					productVersion: `${lifxDevice.VendorId}-${lifxDevice.ProductId}-${lifxDevice.HardwareVersion}`,
					id: lifxDevice.DeviceID,
					supColor: lifxDevice.SupportsColor
				}
			}
			devices.push(newDevice);
		});
		return devices;
	}

	/**
	 * Strips the my_device info from the flowcard arguements payload and replaces it with specific device infos.
	 * @param {object} data Flowcard arguements containing the my_device object.
	 * @returns {object} Returns data without the my_device object and dedicated device details instead.
	 */
	sanitzeDeviceDataForLogging(data) {
		if (data.my_device) {
			const { my_device, ...dbg } = data;
			let dData = data.my_device.getData();
			let dName = data.my_device.getName();
			dbg.Device = {
				Name: dName,
				Data: dData
			}
			return dbg;
		}
		return data;
	}

	get cloudApiToken() {
		return this.homey.settings.get('cloudApiToken');
	}
	set cloudApiToken(value) {
		this.homey.settings.set('cloudApiToken', value);
	}

	/* Logic Behavior
	Athom requires to have a certain logic implemented for light devices. This is might not be good for everyone or every usecase.
	To come around this, the Athom logic will now be the default, but the user will be able to change the behavior to LIFX style or legacy.
	0 = Athom logic
	1 = LIFX logic
	2 = Legacy Logic
	*/
	get logicBehavior() {
		let storedBehavior = this.homey.settings.get('logicBehavior');
		if (storedBehavior == null) {
			storedBehavior = 'Athom';
		} else {
			if (storedBehavior != 'Athom' && storedBehavior != 'LIFX' && storedBehavior != 'Legacy') storedBehavior = 'Athom';
		}
		return storedBehavior;
	}
	set logicBehavior(value) {
		if (value != 'Athom' && value != 'LIFX' && value != 'Legacy') return;
		this.homey.settings.set('logicBehavior', value);
		this.homey.app.LIFX_Manager.OperationMode = value;
	}

	get kelvinBehavior() {
		let storedBehavior = this.homey.settings.get('kelvinBehavior');
		if (storedBehavior == null) {
			storedBehavior = 'LIFX';
		} else {
			if (storedBehavior != 'LIFX' && storedBehavior != 'ADOBE' && storedBehavior != 'IGNORE') storedBehavior = 'LIFX';
		}
		return storedBehavior;
	}
	set kelvinBehavior(value) {
		if (value != 'LIFX' && value != 'ADOBE' && value != 'IGNORE') return;
		this.homey.settings.set('kelvinBehavior', value);
		this.homey.app.LIFX_Manager.KelvinMode = value;
	}

	get ceEditorKey() {
		return this.homey.settings.get('ceEditorKey');
	}
	set ceEditorKey(value) {
		this.homey.settings.set('ceEditorKey', value);
	}

	get statePollingInterval() {
		var Interval = parseInt(this.homey.settings.get('statePollingInterval'));
		if (isNaN(Interval)) Interval = 10000;
		if (Interval == null) {
			return 10000;
		} else {
			return Interval;
		}
	}
	set statePollingInterval(value) {
		this.homey.settings.set('statePollingInterval', value);
		this.homey.app.LIFX_Manager.PollingInterval = parseInt(this.homey.settings.get('statePollingInterval'));
	}

	get defaultTransitionDuration() {
		var Interval = parseInt(this.homey.settings.get('defaultTransitionDuration'));
		if (isNaN(Interval)) Interval = 500;
		if (Interval == null) {
			return 500;
		} else {
			return Interval;
		}
	}
	set defaultTransitionDuration(value) {
		this.homey.settings.set('defaultTransitionDuration', value);
		this.homey.app.LIFX_Manager.DefaultTransitionDuration = parseInt(this.homey.settings.get('defaultTransitionDuration'));
	}

	// Generic capability update wrapper to simplify the update code
	/**
	 * Updates a device capability in Homey.
	 * @param {HomeyDevice} homeyDevice The Homey device instance.
	 * @param {string} capName Name of the capability.
	 * @param {string} capMsgLabel Label for the log message.
	 * @param {*} capValue New capability value to set.
	 * @param {boolean} logErrorsOnly Set true to log errors only.
	 */
	async updateCapability(homeyDevice, capName, capMsgLabel, capValue, logErrorsOnly) {
		if (!logErrorsOnly) logErrorsOnly = false;
		// Only send update if capability is valid and the value has changed.
		if (homeyDevice.hasCapability(capName)) {
			if (capValue != homeyDevice.getCapabilityValue(capName)) {
				if (capName == 'relay_0') {
					this.homey.app.onCapabilityRelay_FireTrigger(homeyDevice, 0, capValue);
				} else if (capName == 'relay_1') {
					this.homey.app.onCapabilityRelay_FireTrigger(homeyDevice, 1, capValue);
				} else if (capName == 'relay_2') {
					this.homey.app.onCapabilityRelay_FireTrigger(homeyDevice, 2, capValue);
				} else if (capName == 'relay_3') {
					this.homey.app.onCapabilityRelay_FireTrigger(homeyDevice, 3, capValue);
				}
				// Fire hev status changed trigger
				if (capName == 'hev_last_result') {
					let trigger_hev_tokens = {
						'hev_status_hr': capValue
					};
					let trigger_hev_state = {
					};
					this.homey.app.Trigger_DeviceHevStatusChangedHr.trigger(homeyDevice, trigger_hev_tokens, trigger_hev_state)
						.then(() => {
							homeyDevice.Log.Log("Fired Trigger_DeviceHevStatusChangedHr for ", homeyDevice.getName());
							return Promise.resolve();
						})
						.catch(err => {
							homeyDevice.Log.Error("Fired Trigger_DeviceHevStatusChangedHr for ", homeyDevice.getName(), ' failed: ', err);
							return Promise.resolve();
						});
				}
				if (capName == 'hev_last_result_machine_readable') {
					let trigger_hev_tokens = {
						'hev_status_mr': capValue
					};
					let trigger_hev_state = {
					};
					this.homey.app.Trigger_DeviceHevStatusChanged.trigger(homeyDevice, trigger_hev_tokens, trigger_hev_state)
						.then(() => {
							homeyDevice.Log.Log("Fired Trigger_DeviceHevStatusChanged for ", homeyDevice.getName());
							return Promise.resolve();
						})
						.catch(err => {
							homeyDevice.Log.Error("Fired Trigger_DeviceHevStatusChanged for ", homeyDevice.getName(), ' failed: ', err);
							return Promise.resolve();
						});
				}

				homeyDevice.setCapabilityValue(capName, capValue)
					.then(result => {
						if (logErrorsOnly !== true) homeyDevice.Log.Log(homeyDevice.getName(), ' updateCapability: ', capMsgLabel, ' - ', capValue);
					})
					.catch(err => {
						homeyDevice.Log.Error(homeyDevice.getName(), ' updateCapability: ', capMsgLabel, ' - ', capValue, ' - ', err);
					})
			}
		}
	} //updateCapability

	//TODO: Relay: Replace by actual power measuring events when available
	async FakePowerConsumptionUpdate(my_device) {
		if (my_device.LIFX_Device != null) {
			this.homey.app.updateCapability(my_device, 'measure_power', 'Overall relays consumption', my_device.LIFX_Device.SwitchEnergyOverall);
		} else {
			this.homey.app.updateCapability(my_device, 'measure_power', 'Overall relays consumption', 0);
		}
	}

	async UpgradeCapability(current_device, cap_name) {
		if (!current_device.hasCapability(cap_name)) {
			current_device.Log.Log(current_device.getName(), " Does not have ", cap_name, " adding it now..");
			await current_device.addCapability(cap_name)
				.catch(err => {
					current_device.Log.Error(current_device.getName(), " Problem adding capability to ", cap_name, " -> ", err);
				});
		}
	}
	async DowngradeCapability(current_device, cap_name) {
		if (current_device.hasCapability(cap_name)) {
			current_device.Log.Log(current_device.getName(), " Does have ", cap_name, " removing it now..");
			await current_device.removeCapability(cap_name)
				.catch(err => {
					current_device.Log.Error(current_device.getName(), " Problem removing capability to ", cap_name, " -> ", err);
				});
		}
	}
	/**
	  * Waits for the device to be ready.
	  */
	async WaitOnInitComplete(current_device) {
		let self = this;
		if (current_device.waitDeviceInitTimeout != null) {
			clearTimeout(current_device.waitDeviceInitTimeout);
			current_device.waitDeviceInitTimeout = null;
		}
		if (current_device.LIFX_Device.Ready === false) {
			if (current_device.getAvailable() === true) current_device.setUnavailable(this.homey.__("inAppErrors.waitOnInitComplete"));
			current_device.waitDeviceInitTimeout = setTimeout(function () { self.homey.app.WaitOnInitComplete(current_device); }, 3000);
			return;
		}
		// Hardware support logic
		if (current_device.LIFX_Device.SupportsHev == false) {
			await this.homey.app.DowngradeCapability(current_device, `hev_default_len`);
			await this.homey.app.DowngradeCapability(current_device, `hev_current_len`);
			await this.homey.app.DowngradeCapability(current_device, `hev_remaining_len`);
			await this.homey.app.DowngradeCapability(current_device, `hev_progress_percentage`);
			await this.homey.app.DowngradeCapability(current_device, `hev_last_result`);
			await this.homey.app.DowngradeCapability(current_device, `hev_toggle`);
		} else {
			await this.homey.app.UpgradeCapability(current_device, `hev_default_len`);
			await this.homey.app.UpgradeCapability(current_device, `hev_current_len`);
			await this.homey.app.UpgradeCapability(current_device, `hev_remaining_len`);
			await this.homey.app.UpgradeCapability(current_device, `hev_progress_percentage`);
			await this.homey.app.UpgradeCapability(current_device, `hev_last_result`);
			await this.homey.app.UpgradeCapability(current_device, `hev_toggle`);
		}
		//TODO: SupportsButtons not available, yet.
		// SupportsRelays
		for (var rIdx = 0; rIdx < 4; rIdx++) {
			if (rIdx < current_device.LIFX_Device.NumberOfRelays) {
				await this.homey.app.UpgradeCapability(current_device, `relay_${rIdx}`);
			} else {
				await this.homey.app.DowngradeCapability(current_device, `relay_${rIdx}`);
			}
		}
		//TODO: Relay: Replace with actual power measuring data when ready
		if (current_device.LIFX_Device.NumberOfRelays > 0) {
			await this.homey.app.UpgradeCapability(current_device, `measure_power`);
			if (current_device.PowerMonitor == null) {
				current_device.PowerMonitor = setInterval(async function () {
					self.homey.app.FakePowerConsumptionUpdate(current_device);
				});
			}
		} else {
			await this.homey.app.DowngradeCapability(current_device, `measure_power`);
		}
		//TODO: Relay: Support relay dimming when available for now remove dimming if we have relays
		if (current_device.LIFX_Device.NumberOfRelays > 0) {
			await this.homey.app.DowngradeCapability(current_device, `dim`);
		} else {
			await this.homey.app.UpgradeCapability(current_device, `dim`);
		}
		if (current_device.LIFX_Device.SupportsMultizone == false) {
			await this.homey.app.DowngradeCapability(current_device, `multiple_zones`);
		} else {
			await this.homey.app.UpgradeCapability(current_device, `multiple_zones`);
		}
		if (current_device.LIFX_Device.SupportsChain == false) {
			await this.homey.app.DowngradeCapability(current_device, `chain_device`);
		} else {
			await this.homey.app.UpgradeCapability(current_device, `chain_device`);
		}
		if (current_device.LIFX_Device.SupportsInfrared == false) {
			await this.homey.app.DowngradeCapability(current_device, `infrared_max_level`);
		} else {
			await this.homey.app.UpgradeCapability(current_device, `infrared_max_level`);
		}
		if (current_device.LIFX_Device.SupportsColor == false) {
			await this.homey.app.DowngradeCapability(current_device, `light_hue`);
			await this.homey.app.DowngradeCapability(current_device, `light_saturation`);
		} else {
			await this.homey.app.UpgradeCapability(current_device, `light_hue`);
			await this.homey.app.UpgradeCapability(current_device, `light_saturation`);
		}
		if (current_device.LIFX_Device.SupportsTemperature == false) {
			await this.homey.app.DowngradeCapability(current_device, `light_temperature`);
		} else {
			await this.homey.app.UpgradeCapability(current_device, `light_temperature`);
		}
		// Remove mode if only one mode is there..
		if (current_device.LIFX_Device.SupportsTemperature == false || current_device.LIFX_Device.SupportsColor == false) {
			await this.homey.app.DowngradeCapability(current_device, `light_mode`);
		} else if (current_device.LIFX_Device.SupportsTemperature == true && current_device.LIFX_Device.SupportsColor == true) {
			await this.homey.app.UpgradeCapability(current_device, `light_mode`);
		}
		// Handle matrix support device support..
		if (current_device.LIFX_Device.SupportsMatrix == false) {
			await this.homey.app.DowngradeCapability(current_device, `matrix_device`);
		} else if (current_device.LIFX_Device.SupportsMatrix == true) {
			await this.homey.app.UpgradeCapability(current_device, `matrix_device`);
		}
		// Automigrate missing flux capabillity
		if (current_device.hasCapability("current_ambient_flux")) {
			//current_device.addCapability("current_ambient_flux");
			await this.homey.app.DowngradeCapability(current_device, `current_ambient_flux`);
		}
		// Subscribe device events
		/*
			Unused:
				- unsupported (LIFX_Device)
				- new_name (string)
				- new_zones_data (LIFX_Device)
				- new_wifi_info (LIFX_Device) -> used to update advanced device settings infos
		*/
		// Online Status
		if (current_device.__needUpdateSubscriptions === true) {
			current_device.LIFX_Device.on('device_offline', function (lifx_device) {
				let trigger_specific_device_tokens = {
					'device_label': current_device.getName()
				};
				let trigger_specific_device_state = {
				};
				current_device.__setOnlineState(false);
				self.homey.app.Trigger_DeviceGone.trigger(current_device, trigger_specific_device_tokens, trigger_specific_device_state)
					.then(() => {
						current_device.Log.Log("Fired trigger specific_device_gone for ", current_device.getName());
						return Promise.resolve();
					})
					.catch(err => {
						current_device.Log.Error("Fired trigger specific_device_gone for ", current_device.getName(), ' failed: ', err);
						return Promise.resolve();
					})
			});
			current_device.LIFX_Device.on('device_online', function (lifx_device) {
				let trigger_specific_device_tokens = {
					'device_label': current_device.getName()
				};
				let trigger_specific_device_state = {
				};
				current_device.__setOnlineState(true);
				self.homey.app.Trigger_DeviceBack.trigger(current_device, trigger_specific_device_tokens, trigger_specific_device_state)
					.then(() => {
						current_device.Log.Log("Fired trigger specific_device_back for: ", current_device.getName());
						return Promise.resolve();
					})
					.catch(err => {
						current_device.Log.Error("Fired trigger specific_device_back for: ", current_device.getName(), ' failed: ', err);
						return Promise.resolve();
					})
			});
		}
		current_device.__setOnlineState(current_device.LIFX_Device.Online);
		// Relays
		if (current_device.LIFX_Device.SupportsRelays === true) {
			if (current_device.__needUpdateSubscriptions === true) {
				current_device.LIFX_Device.on('new_relay_overall', current_device.__updateOnOff.bind(current_device));
				current_device.LIFX_Device.on('new_relay_level', current_device.__updateRelay.bind(current_device));
			}
			for (var rIdx = 0; rIdx < current_device.LIFX_Device.NumberOfRelays; rIdx++) {
				current_device.__updateRelay(rIdx, current_device.LIFX_Device.GetRelayStatus());
			}
			current_device.__updateRelaysCount(current_device.LIFX_Device.NumberOfRelays);
		}
		// Zones
		if (current_device.__needUpdateSubscriptions === true) current_device.LIFX_Device.on('new_zones_count', current_device.__updateZonesCount.bind(current_device));
		current_device.__updateZonesCount(current_device.LIFX_Device.ZonesCount);
		// Implement HEV update events
		if (current_device.hasCapability("hev_toggle")) {
			if (current_device.__needUpdateSubscriptions === true) {
				current_device.LIFX_Device.on('status_hev_result', current_device.__updateHevResult.bind(current_device));
				current_device.LIFX_Device.on('status_hev_cycle', current_device.__updateHevCycleInfo.bind(current_device));
				current_device.LIFX_Device.on('hev_cycle', current_device.__updateHevCycle.bind(current_device));
				current_device.LIFX_Device.on('status_hev_config', current_device.__updateHevCycleConfig.bind(current_device));
			}
			current_device.__updateHevResult(current_device.LIFX_Device.Status.hev.last_result);
			current_device.__updateHevCycleInfo({ remaining: current_device.LIFX_Device.Status.hev.duration_remaining, duration: current_device.LIFX_Device.Status.hev.duration_current });
			current_device.__updateHevCycle(current_device.LIFX_Device.Status.hev.toggle);
			current_device.__updateHevCycleConfig(current_device.LIFX_Device.Status.hev.duration_default);
		}
		// Infrared
		if (current_device.hasCapability("infrared_max_level")) {
			if (current_device.__needUpdateSubscriptions === true) current_device.LIFX_Device.on('status_infrared', current_device.__updateInfrared.bind(current_device));
			current_device.__updateInfrared(current_device.LIFX_Device.Infrared);
		}
		// OnOff
		if (current_device.hasCapability("onoff")) {
			if (current_device.__needUpdateSubscriptions === true) current_device.LIFX_Device.on('status_onoff', current_device.__updateOnOff.bind(current_device));
			current_device.__updateOnOff(current_device.LIFX_Device.OnOff);
		}
		// Dim
		if (current_device.hasCapability("dim")) {
			if (current_device.__needUpdateSubscriptions === true) current_device.LIFX_Device.on('new_dim', current_device.__updateDim.bind(current_device));
			current_device.__updateDim(current_device.LIFX_Device.DimLevel);
		}
		//  Temperature
		if (current_device.hasCapability("light_temperature")) {
			if (current_device.__needUpdateSubscriptions === true) current_device.LIFX_Device.on('new_temperature', current_device.__updateTemp.bind(current_device));
			current_device.__updateTemp(current_device.LIFX_Device.LightTemperature);
		}
		// Saturation
		if (current_device.hasCapability("light_saturation")) {
			if (current_device.__needUpdateSubscriptions === true) current_device.LIFX_Device.on('new_saturation', current_device.__updateSat.bind(current_device));
			current_device.__updateSat(current_device.LIFX_Device.LightSaturation);
		}
		// Color
		if (current_device.hasCapability("light_hue")) {
			if (current_device.__needUpdateSubscriptions === true) current_device.LIFX_Device.on('new_color', current_device.__updateColor.bind(current_device));
			current_device.__updateColor(current_device.LIFX_Device.LightColor);
		}
		// Color Mode
		if (current_device.hasCapability("light_mode")) {
			if (current_device.__needUpdateSubscriptions === true) current_device.LIFX_Device.on('color_mode', current_device.__updateMode.bind(current_device));
			current_device.__updateMode(current_device.LIFX_Device.ColorMode);
		}
		// Energy Settings
		if (current_device.__needUpdateSubscriptions === true) current_device.LIFX_Device.on('new_energy_settings', async function () { self.homey.app.__updateEnergyData(current_device); });
		this.homey.app.__updateEnergyData(current_device);
		// Firmware Version
		if (current_device.__needUpdateSubscriptions === true) current_device.LIFX_Device.on('new_firmware_info', async function () { self.homey.app.__updateFirmwareInfo(current_device); });
		this.homey.app.__updateFirmwareInfo(current_device);
		// WiFi Firmware Version
		if (current_device.__needUpdateSubscriptions === true) current_device.LIFX_Device.on('new_wifi_firmware_info', async function () { self.homey.app.__updateWifiFirmwareInfo(current_device); });
		this.homey.app.__updateWifiFirmwareInfo(current_device);
		// Update Device Infos
		if (current_device.__needUpdateSubscriptions === true) current_device.LIFX_Device.on('new_wifi_info', async function () { self.homey.app.__updateDeviceInfos(current_device); });
		this.homey.app.__updateDeviceInfos(current_device);
		// Remember that we subscribed the update event delegates..
		current_device.__needUpdateSubscriptions = false;
		// Enable device in UI
		if (current_device.getAvailable() === false) current_device.setAvailable();
	}

	/**
	 * Waits for the actual device to become available to the app.
	  */
	WaitOnDevice(current_device) {
		let self = this;
		if (current_device.waitDeviceTimeout != null) {
			clearTimeout(current_device.waitDeviceTimeout);
			current_device.waitDeviceTimeout = null;
		}
		var device_data = current_device.getData();
		current_device.LIFX_Device = this.homey.app.LIFX_Manager.GetDeviceById(device_data.id);
		if (current_device.LIFX_Device == null) {
			if (current_device.getAvailable() === true) current_device.setUnavailable(this.homey.__("inAppErrors.waitOnDevice"));
			current_device.waitDeviceTimeout = setTimeout(function () { self.homey.app.WaitOnDevice(current_device); }, 2000);
			return;
		}
		this.homey.app.WaitOnInitComplete(current_device);
	}

	async __updateWifiFirmwareInfo(current_device) {
		if (current_device.LIFX_Device.Status.Wifi.Firmware.majorVersion == 0 && current_device.LIFX_Device.Status.Wifi.Firmware.minorVersion == 0) {
			let oldChkValue = current_device.getSettings('wifi_majorVersion');
			if (oldChkValue != this.homey.__("inAppErrors.dataNotAvailable")) {
				await current_device.setSettings({
					wifi_majorVersion: this.homey.__("inAppErrors.dataNotAvailable"),
					wifi_minorVersion: this.homey.__("inAppErrors.dataNotAvailable")
				}).catch(err => {
					current_device.Log.Error(current_device.LIFX_Device.Name, " setSettings(wifiVersion): ", err);
				})
			}
		} else {
			let oldWFMaV = current_device.getSettings('wifi_majorVersion');
			let oldWFMiV = current_device.getSettings('wifi_minorVersion');
			if (oldWFMaV != current_device.LIFX_Device.Status.Wifi.Firmware.majorVersion.toString() || oldWFMiV != current_device.LIFX_Device.Status.Wifi.Firmware.minorVersion.toString()) {
				await current_device.setSettings({
					wifi_majorVersion: current_device.LIFX_Device.Status.Wifi.Firmware.majorVersion.toString(),
					wifi_minorVersion: current_device.LIFX_Device.Status.Wifi.Firmware.minorVersion.toString()
				}).catch(err => {
					current_device.Log.Error(current_device.LIFX_Device.Name, "setSettings(wifiVersion): ", err);
				})
			}
		}
	}

	async __updateFirmwareInfo(current_device) {
		let oldMaV = current_device.getSettings('majorVersion');
		let oldMiV = current_device.getSettings('minorVersion');
		if (oldMaV != current_device.LIFX_Device.FirmwareMajorVersion || oldMiV != current_device.LIFX_Device.FirmwareMinorVersion) {
			await current_device.setSettings({
				majorVersion: current_device.LIFX_Device.FirmwareMajorVersion,
				minorVersion: current_device.LIFX_Device.FirmwareMinorVersion
			}).catch(err => {
				current_device.Log.Error(current_device.LIFX_Device.Name, " setSettings(firmwareVersion): ", err);
			})
		}
	}

	async __updateDeviceInfos(current_device) {
		let currentSettings = current_device.getSettings();
		let newDeviceInfoSettings = {};
		if (currentSettings.tempMin != current_device.LIFX_Device.TemperatureRange.Min) newDeviceInfoSettings.tempMin = current_device.LIFX_Device.TemperatureRange.Min;
		if (currentSettings.tempMax != current_device.LIFX_Device.TemperatureRange.Max) newDeviceInfoSettings.tempMax = current_device.LIFX_Device.TemperatureRange.Max;
		if (currentSettings.supportColor != current_device.LIFX_Device.SupportsColor) newDeviceInfoSettings.supportColor = current_device.LIFX_Device.SupportsColor;
		if (currentSettings.supportInfrared != current_device.LIFX_Device.SupportsInfrared) newDeviceInfoSettings.supportInfrared = current_device.LIFX_Device.SupportsInfrared;
		if (currentSettings.supportMultiZone != current_device.LIFX_Device.SupportsMultizone) newDeviceInfoSettings.supportMultiZone = current_device.LIFX_Device.SupportsMultizone;
		if (currentSettings.supportChain != current_device.LIFX_Device.SupportsChain) newDeviceInfoSettings.supportChain = current_device.LIFX_Device.SupportsChain;
		if (currentSettings.supportMatrix != current_device.LIFX_Device.SupportsMatrix) newDeviceInfoSettings.supportMatrix = current_device.LIFX_Device.SupportsMatrix;
		if (currentSettings.supportHev != current_device.LIFX_Device.SupportsHev) newDeviceInfoSettings.supportHev = current_device.LIFX_Device.SupportsHev;
		//TODO: Relay: add relais support and button support
		if (currentSettings.vendorName != current_device.LIFX_Device.VendorName) newDeviceInfoSettings.vendorName = current_device.LIFX_Device.VendorName;
		if (currentSettings.productName != current_device.LIFX_Device.ProductName) newDeviceInfoSettings.productName = current_device.LIFX_Device.ProductName;
		if (currentSettings.version != current_device.LIFX_Device.HardwareVersion) newDeviceInfoSettings.version = current_device.LIFX_Device.HardwareVersion;
		if (currentSettings.vendorId != current_device.LIFX_Device.VendorId) newDeviceInfoSettings.vendorId = current_device.LIFX_Device.VendorId;
		if (currentSettings.productId != current_device.LIFX_Device.ProductId) newDeviceInfoSettings.productId = current_device.LIFX_Device.ProductId;
		if (Object.entries(newDeviceInfoSettings).length > 0) {
			current_device.Log.Log(current_device.getName(), " Updating device infos: ", newDeviceInfoSettings);
			await current_device.setSettings(newDeviceInfoSettings)
				.catch(err => {
					current_device.Log.Error(current_device.getName(), " setSettings(newDeviceInfoSettings): ", err);
				})
		}
	}

	async __updateEnergyData(current_device) {
		if (current_device.LIFX_Device.EnergyData != null) {
			let new_energy_object = {
				'approximation': current_device.LIFX_Device.EnergyData
			};
			current_device.Log.Log("Found energy data for Vendor: ", current_device.LIFX_Device.VendorId, " Product: ", current_device.LIFX_Device.ProductId, " Device: ", current_device.LIFX_Device.ProductName, " Named: ", current_device.LIFX_Device.Name, ": ", new_energy_object.approximation.usageOff, ' to ', new_energy_object.approximation.usageOn);
			await current_device.setEnergy(new_energy_object);
			let newSettingsPowerData = {
				powerStandby: current_device.LIFX_Device.EnergyData.usageOff.toString(),
				powerFull: current_device.LIFX_Device.EnergyData.usageOn.toString()
			};
			await current_device.setSettings(newSettingsPowerData)
				.catch(err => {
					current_device.Log.Error(current_device.Name, " setSettings(newSettingsPowerData): ", err);
				})
		} else {
			current_device.Log.Warn("No energy data for Vendor: ", current_device.LIFX_Device.VendorId, " Product: ", current_device.LIFX_Device.ProductId, " Device: ", current_device.LIFX_Device.ProductName, " Named: ", current_device.LIFX_Device.Name);
		}
	}

	async onCapabilityRelay_FireTrigger(current_device, rIdx, value) {
		if (value === true) {
			this.homey.app.Trigger_Relay[rIdx].on.trigger(current_device, {}, {})
				.then(() => {
					current_device.Log.Log(`Fired Trigger_Relay[${rIdx}].on for: `, current_device.getName());
					return Promise.resolve();
				})
				.catch(err => {
					current_device.Log.Error(`Trigger_Relay[${rIdx}].on failed for: `, current_device.getName(), ' - ', err);
					return Promise.resolve();
				});
		} else {
			this.homey.app.Trigger_Relay[rIdx].off.trigger(current_device, {}, {})
				.then(() => {
					current_device.Log.Log(`Fired Trigger_Relay[${rIdx}].off for: `, current_device.getName());
					return Promise.resolve();
				})
				.catch(err => {
					current_device.Log.Error(`Trigger_Relay[${rIdx}].off failed for: `, current_device.getName(), ' - ', err);
					return Promise.resolve();
				});
		}
	}

}

module.exports = SDN_LIFX_LAN2;
