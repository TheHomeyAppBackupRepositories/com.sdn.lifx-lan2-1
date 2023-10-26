'use strict';

const FileSystem = require('fs');
const Log = require('../lib/console_logger');

/*
  Emits Events:

  Public Methods:
    - files[]   GetInstalledEffectsFiles()    Loads a file list of all installed effects.

  Public Fields/Properties:
*/

class LIFX_Effects {

  GetInstalledEffectsFiles() {
    let foundFiles = [];
    var effectsScanPath = '';
    //NOTE: Could be done by this.homey.platformVersion >= 2 too OR perhaps path.join(process.cwd(), '/lib'
    if (FileSystem.existsSync('/lib/effects_library/')) {
      effectsScanPath = '/lib/effects_library/';
    } else {
      effectsScanPath = '/app/lib/effects_library/';
    }
    FileSystem.readdirSync(effectsScanPath).forEach(file => {
      if (file != 'template.json') foundFiles.push(file);
    });
    return foundFiles;
  }

  constructor() {
    this.Log = new Log('LIFX Effects');
    this.Log.Log('Instancing..');
    this.Log.Log('Ready.');
  }

}

module.exports = LIFX_Effects;
