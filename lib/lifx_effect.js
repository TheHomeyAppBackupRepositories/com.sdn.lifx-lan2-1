'use strict';

const FileSystem = require('fs');
const Log = require('../lib/console_logger');
const EventEmitter = require('events');

/*
  Emits Events:
    - effect_ended      Signals that the effect has stopped.

  Public Methods:
    - void    Start()   Starts an effect.
    - void    Stop()    Stops an effect.
    
    Public Fields/Properties:
    - [get]     Name          = string    Name of the effect.
    - [get]     RequiredZones = number    Amount of zones required for this effect.
    - [get]     Looped        = bool      Whether the effect is looped by default or has been set to loop explicitly.
    - [get]     Active        = bool      Whether the effect is running.
    - [get|set] RestoreLightsAfterEventEnds = bool  Whether or not to restore light states when the event ends.

  Effect Type 1: https://lan.developer.lifx.com/docs/waveforms
*/

class LIFX_Effect extends EventEmitter {

  constructor(effectFile, effectZones, loop) {
    super();
    this.Log = new Log(`LIFX Effect ${effectFile}`);
    this.Log.Log('Instancing..');
    var effectsScanPath = '/lib/effects_library/';
    //NOTE: Could be done by this.homey.platformVersion >= 2 too OR perhaps path.join(process.cwd(), '/lib'
    if (FileSystem.existsSync('/lib/effects_library/')) {
      effectsScanPath = '/lib/effects_library/';
    } else {
      effectsScanPath = '/app/lib/effects_library/';
    }
    if (typeof effectFile == 'string') {
      let stringData = FileSystem.readFileSync(`${effectsScanPath}${effectFile}`, 'utf-8');
      this.__data = JSON.parse(stringData);
    } else {
      this.__data = effectFile;
    }
    this.Name = this.__data.Name;
    this.RequiredZones = 0;
    this.__data.Choreo.forEach(chScan => {
      chScan.Cmds.forEach(cmdScan => {
        if (cmdScan.Zone > this.RequiredZones) this.RequiredZones = cmdScan.Zone;
      });
    });
    if (this.RequiredZones == 0) {
      this.RequiredZones = 1;
    } else {
      this.RequiredZones++;
    }
    this.RestoreLightsAfterEventEnds = true;
    this.__zones = effectZones;
    this.__active = false;
    this.__choreoIdx = 0;
    this.__scheduler = null;
    this.__looped = this.__data.Looped;
    if (loop && loop === true) {
      this.__looped = true;
    }
    this.Log.Log('Custom effect: ', this.Name, ' ready.');
  }

  get Looped() {
    return this.__looped;
  }

  get Active() {
    return this.__active;
  }

  __resetEffectChoreo(effectObj) {
    for (var i = 0; i < effectObj.__data.Choreo.length; i++) {
      effectObj.__data.Choreo[i].Played = false;
    }
    effectObj.__choreoIdx = 0;
  }

  GetRandomNumber(min, max, hasDecimals) {
    if (hasDecimals === true) {
      return Math.round(((Math.random() * (max - min)) + min) * 100) / 100
    } else {
      return (Math.random() * (max - min)) + min;
    }
  }

  __runCmd_randomizeColorObj(colObj1, colObj2) {
    var newColObj = {
      H: null,
      S: null,
      B: null,
      K: null
    };
    if (colObj1.K != null) newColObj.K = this.GetRandomNumber(colObj1.K, colObj2.K, true);
    if (colObj1.H != null) newColObj.H = this.GetRandomNumber(colObj1.H, colObj2.H, false);
    if (colObj1.S != null) newColObj.S = this.GetRandomNumber(colObj1.S, colObj2.S, false);
    if (colObj1.B != null) newColObj.B = this.GetRandomNumber(colObj1.B, colObj2.B, false);
    return newColObj;
  }

  async __runCmd(effectObj, cmdObj) {
    // Run Commands
    var zonesToProcess = [];
    if (cmdObj.AllZ == true) {
      for (var idx = 0; idx < effectObj.__zones.length; idx++) {
        zonesToProcess.push(idx);
      }
    } else {
      if (cmdObj.Zone == -1) {
        zonesToProcess.push(Math.round(Math.random() * (effectObj.__zones.length - 1)));
      } else {
        zonesToProcess.push(cmdObj.Zone);
      }
    }
    // Pre-process color data
    var colorToUse = null;
    if (typeof cmdObj.Color == "string") {
      colorToUse = cmdObj.Color;
    } else {
      if (cmdObj.ColorRndMode && cmdObj.ColorRndMode > 0) {
        if (cmdObj.Type == 0 || cmdObj.Type == 1) {
          colorToUse = this.__runCmd_randomizeColorObj(cmdObj.Color, cmdObj.ColorMax);
        }
      } else {
        colorToUse = cmdObj.Color;
      }
    }
    // LenMax logic
    var lenToUse = cmdObj.Len;
    if (cmdObj.LenMode > 0) {
      lenToUse = this.GetRandomNumber(cmdObj.Len, cmdObj.LenMax, false);
    }
    // Process command sending..
    zonesToProcess.forEach(zIdx => {
      effectObj.__zones[zIdx].forEach(lifxDevice => {
        if (lifxDevice.SupportsColor === false) return;
        if (cmdObj.LenMode == 2) {
          lenToUse = this.GetRandomNumber(cmdObj.Len, cmdObj.LenMax, false);
        }
        if (cmdObj.Type == 0) {
          // setColor Command
          var newK = 0;
          if (typeof colorToUse == "string") {
            var hsbk = lifxDevice.Manager.__getColorObjectFromHex(colorToUse, true);
            this.__updateDeviceCoreData(lifxDevice, { H: hsbk.hue, B: hsbk.brightness, S: hsbk.saturation, K: null });
            lifxDevice.__device.color(hsbk.hue, hsbk.saturation, hsbk.brightness, hsbk.kelvin, lenToUse, function (err) {
              if (err) {
                // No error handling.
              }
            });
          } else {
            if (cmdObj.ColorRndMode && cmdObj.ColorRndMode == 2) colorToUse = this.__runCmd_randomizeColorObj(cmdObj.Color, cmdObj.ColorMax);
            if (colorToUse.K == null) {
              newK = lifxDevice.Manager.MapScale(0.0, 1.0, lifxDevice.TemperatureRange.Max, lifxDevice.TemperatureRange.Min, lifxDevice.LightTemperature);
            } else {
              newK = lifxDevice.Manager.MapScale(0.0, 1.0, lifxDevice.TemperatureRange.Max, lifxDevice.TemperatureRange.Min, colorToUse.K);
            }
            this.__updateDeviceCoreData(lifxDevice, colorToUse);
            lifxDevice.__device.color((colorToUse.H == null) ? lifxDevice.LightColor : colorToUse.H, (colorToUse.S == null) ? lifxDevice.LightSaturation * 100 : colorToUse.S, (colorToUse.B == null) ? lifxDevice.DimLevel * 100 : colorToUse.B, newK, lenToUse, function (err) {
              if (err) {
                // No error handling.
              }
            });
          }
        } else if (cmdObj.Type == 1) {
          // setWaveform Command
          if (typeof colorToUse == "string") {
            lifxDevice.Manager.API_SendCommandPacket(lifxDevice, lifxDevice.Manager.API_CreateWaveFormPacket(colorToUse, lenToUse, cmdObj.Rep, cmdObj.Wave, cmdObj.Skew, cmdObj.Trans));
          } else {
            if (cmdObj.ColorRndMode && cmdObj.ColorRndMode == 2) colorToUse = this.__runCmd_randomizeColorObj(cmdObj.Color, cmdObj.ColorMax);
            lifxDevice.Manager.API_SendCommandPacket(lifxDevice, lifxDevice.Manager.API_CreateWaveFormPacket(lifxDevice.Manager.API_CreateHardwareColorObject((colorToUse.H == null) ? lifxDevice.LightColor : colorToUse.H, (colorToUse.S == null) ? lifxDevice.LightSaturation * 100 : colorToUse.S, (colorToUse.B == null) ? lifxDevice.DimLevel * 100 : colorToUse.B, (colorToUse.K == null) ? lifxDevice.LightTemperature : colorToUse.K, lifxDevice), lenToUse, cmdObj.Rep, cmdObj.Wave, cmdObj.Skew, cmdObj.Trans));
          }
        }
      });
    });
  }

  __updateDeviceCoreData(lifxDevice, colorObject) {
    if (colorObject.B !== null) {
      var newVal = lifxDevice.Manager.MapScale(0, 100, 0.0, 1.0, colorObject.B);
      if (lifxDevice.Status.dim != newVal) {
        lifxDevice.Status.dim = newVal;
        lifxDevice.emit('new_dim', newVal);
      }
    }
    if (colorObject.S !== null) {
      var newVal = lifxDevice.Manager.MapScale(0, 100, 0.0, 1.0, colorObject.S);
      if (lifxDevice.Status.saturation != newVal) {
        lifxDevice.Status.saturation = newVal;
        lifxDevice.emit('new_saturation', newVal);
      }
    }
    if (colorObject.H !== null) {
      var newVal = colorObject.H;
      if (lifxDevice.Status.color != newVal) {
        lifxDevice.Status.color = newVal;
        lifxDevice.emit('new_color', newVal);
      }
    }
    if (colorObject.K !== null) {
      var newVal = colorObject.K;
      if (lifxDevice.Status.temperature != newVal) {
        lifxDevice.Status.temperature = newVal;
        lifxDevice.emit('new_temperature', newVal);
      }
    }
  }

  __killScheduler(effectObj) {
    clearInterval(effectObj.__scheduler);
    effectObj.__scheduler = null;
  }

  __nextChoreo(effectObj) {
    effectObj.__data.Choreo[effectObj.__choreoIdx].Cmds.forEach(cmd => {
      effectObj.__runCmd(effectObj, cmd);
    });
    effectObj.__data.Choreo[effectObj.__choreoIdx].Played = true;
    // Random next feature
    // Schedule next
    if (effectObj.__active === true) {
      var oldIndex = effectObj.__choreoIdx;
      if (effectObj.__data.Choreo[effectObj.__choreoIdx].RndNext === true) {
        var search = false;
        effectObj.__choreoIdx = Math.round(Math.random() * (effectObj.__data.Choreo.length - 1));
        while ((effectObj.__data.IgnorePlayed != true && effectObj.__data.Choreo[effectObj.__choreoIdx].Played === true) || (effectObj.__data.Choreo[effectObj.__choreoIdx].RndBlock && effectObj.__data.Choreo[effectObj.__choreoIdx].RndBlock === true)) {
          effectObj.__choreoIdx++;
          if (effectObj.__data.Choreo.length == effectObj.__choreoIdx) {
            if (search === true) {
              var linger = (effectObj.__data.Choreo[oldIndex].LingerMax == null) ? effectObj.__data.Choreo[oldIndex].Linger : Math.round(Math.random() * (effectObj.__data.Choreo[oldIndex].LingerMax - effectObj.__data.Choreo[oldIndex].Linger) + effectObj.__data.Choreo[oldIndex].Linger);
              if (effectObj.__looped === true) {
                // Loop
                effectObj.__killScheduler(effectObj);
                effectObj.__resetEffectChoreo(effectObj);
                effectObj.__choreoIdx = Math.round(Math.random() * (effectObj.__data.Choreo.length - 1));
                if (linger == 0) {
                  effectObj.__nextChoreo(effectObj);
                } else {
                  effectObj.__scheduler = setTimeout(async function () {
                    effectObj.__nextChoreo(effectObj);
                  }, linger);
                }
              } else {
                // End
                if (linger == 0) {
                  effectObj.__killScheduler(effectObj);
                  effectObj.__resetEffectChoreo(effectObj);
                  effectObj.__active = false;
                  effectObj.__restoreZoneDevicesState();
                  effectObj.emit('effect_ended');
                } else {
                  effectObj.__killScheduler(effectObj);
                  effectObj.__scheduler = setTimeout(async function () {
                    effectObj.__resetEffectChoreo(effectObj);
                    effectObj.__active = false;
                    effectObj.__restoreZoneDevicesState();
                    effectObj.emit('effect_ended');
                    effectObj.__killScheduler(effectObj);
                  }, linger);
                }
              }
            }
            effectObj.__choreoIdx = 0;
            search = true;
          }
        }
      } else {
        effectObj.__choreoIdx++;
      }
      if (effectObj.__data.Choreo.length == effectObj.__choreoIdx) {
        var linger = (effectObj.__data.Choreo[oldIndex].LingerMax == null) ? effectObj.__data.Choreo[oldIndex].Linger : Math.round(Math.random() * (effectObj.__data.Choreo[oldIndex].LingerMax - effectObj.__data.Choreo[oldIndex].Linger) + effectObj.__data.Choreo[oldIndex].Linger);
        if (effectObj.__looped === true) {
          // Loop
          effectObj.__killScheduler(effectObj);
          effectObj.__resetEffectChoreo(effectObj);
          if (linger == 0) {
            effectObj.__nextChoreo(effectObj);
          } else {
            effectObj.__scheduler = setTimeout(async function () {
              effectObj.__nextChoreo(effectObj);
            }, linger);
          }
        } else {
          // End
          if (linger == 0) {
            effectObj.__killScheduler(effectObj);
            effectObj.__resetEffectChoreo(effectObj);
            effectObj.__active = false;
            effectObj.__restoreZoneDevicesState();
            effectObj.emit('effect_ended');
          } else {
            effectObj.__killScheduler(effectObj);
            effectObj.__scheduler = setTimeout(async function () {
              effectObj.__resetEffectChoreo(effectObj);
              effectObj.__active = false;
              effectObj.__restoreZoneDevicesState();
              effectObj.emit('effect_ended');
              effectObj.__killScheduler(effectObj);
            }, linger);
          }
        }
      } else {
        // Schedule next
        effectObj.__killScheduler(effectObj);
        var linger = (effectObj.__data.Choreo[oldIndex].LingerMax == null) ? effectObj.__data.Choreo[oldIndex].Linger : Math.round(Math.random() * (effectObj.__data.Choreo[oldIndex].LingerMax - effectObj.__data.Choreo[oldIndex].Linger) + effectObj.__data.Choreo[oldIndex].Linger);
        if (linger == 0) {
          effectObj.__nextChoreo(effectObj);
        } else {
          this.__scheduler = setTimeout(async function () {
            effectObj.__nextChoreo(effectObj);
          }, linger);
        }
      }
    } else {
      // End
      effectObj.__killScheduler(effectObj);
      effectObj.__scheduler = setTimeout(async function () {
        effectObj.__resetEffectChoreo(effectObj);
        effectObj.__restoreZoneDevicesState();
        effectObj.emit('effect_ended');
        effectObj.__killScheduler(effectObj);
      }, 1000);
    }
  }

  __storeZoneDevicesState() {
    this.__zones.forEach(zone => {
      zone.forEach(lifxDevice => {
        lifxDevice.__afterEffectCmd = {
          "H": lifxDevice.LightColor,
          "S": lifxDevice.LightSaturation,
          "B": lifxDevice.DimLevel,
          "K": lifxDevice.LightTemperature
        }
      });
    });
  }

  __restoreZoneDevicesState() {
    if (this.RestoreLightsAfterEventEnds === false) return;
    this.__zones.forEach(zone => {
      zone.forEach(lifxDevice => {
        // Make sure the LIFX_Device has the original values..
        lifxDevice.LightColor = lifxDevice.__afterEffectCmd.H;
        lifxDevice.LightSaturation = lifxDevice.__afterEffectCmd.S;
        lifxDevice.DimLevel = lifxDevice.__afterEffectCmd.B;
        lifxDevice.LightTemperature = lifxDevice.__afterEffectCmd.K;
        // Set hardware explicity because the LIFX_Device might not be up to date..
        var newK = lifxDevice.Manager.MapScale(0.0, 1.0, lifxDevice.TemperatureRange.Max, lifxDevice.TemperatureRange.Min, lifxDevice.__afterEffectCmd.K);
        lifxDevice.__device.color(lifxDevice.__afterEffectCmd.H, lifxDevice.__afterEffectCmd.S * 100, lifxDevice.__afterEffectCmd.B * 100, newK, lifxDevice.Manager.DefaultTransitionDuration, function (err) {
          if (err) {
            // No error handling.
          }
          // Double force update upon device.
          lifxDevice.LightColor = lifxDevice.__afterEffectCmd.H;
          lifxDevice.LightSaturation = lifxDevice.__afterEffectCmd.S;
          lifxDevice.DimLevel = lifxDevice.__afterEffectCmd.B;
          lifxDevice.LightTemperature = lifxDevice.__afterEffectCmd.K;
        });
        // Double force update upon device.
        lifxDevice.LightColor = lifxDevice.__afterEffectCmd.H;
        lifxDevice.LightSaturation = lifxDevice.__afterEffectCmd.S;
        lifxDevice.DimLevel = lifxDevice.__afterEffectCmd.B;
        lifxDevice.LightTemperature = lifxDevice.__afterEffectCmd.K;
      });
    });
  }

  async Start() {
    if (this.__data.Choreo.length == 0) return;
    if (this.__active == true) return;
    this.__storeZoneDevicesState();
    this.__active = true;
    this.__data.InitCmds.forEach(initCmd => {
      this.__runCmd(this, initCmd);
    });
    let myself = this;
    if (this.__data.InitLinger == 0) {
      this.__nextChoreo(this);
    } else {
      this.__scheduler = setTimeout(async function () {
        myself.__nextChoreo(myself);
      }, this.__data.InitLinger);
    }
  }

  async Stop() {
    this.__active = false;
  }

}

module.exports = LIFX_Effect;
