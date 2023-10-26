'use strict';

var Crypto = require('crypto');

class LicenseManager {

  constructor(deviceId) {
    this.__seasonId = 'K28BVK8EFM0TX6EETPBFG22YRVJGWC42';
    this.__authId = 'PTHRP9WFL3F31DHT9U1FYPIQ0BDF3CCF';
    this.__deviceId = deviceId;
  }

  GetAuthorizationCode(regKey, email) {
    var lcEmail = email.toLowerCase();
    var authRaw = this.__BlackMagic(lcEmail, this.__authId);
    var authBling = this.__BlackMagic(regKey, authRaw);
    return Crypto.createHash('sha256').update(authBling).digest('hex');
  }

  Authorized(authKey, email) {
    if (!authKey || authKey == null || authKey.length < 20 || !email || email == null || email.length < 5) return 1;
    var lcEmail = email.toLowerCase();
    var authRaw = this.__BlackMagic(lcEmail, this.__authId);
    var authBling = this.__BlackMagic(this.GetRegistrationRequestCode(), authRaw);
    return (authKey == Crypto.createHash('sha256').update(authBling).digest('hex')) ? 0 : 2;
  }

  GetRegistrationRequestCode() {
    return Crypto.createHash('sha1').update(this.__BlackMagic(this.__deviceId, this.__seasonId)).digest('hex');
  }

  __BlackMagic(baseId, funkyId) {
    var calcLen = baseId.length;
    if (funkyId.length > baseId.length) calcLen = funkyId.length;
    var base_runner = 0;
    var funky_runner = 0;
    var magic = '';
    var flip = false;
    var idxRun = 0;
    do {
      var x1 = funkyId.charCodeAt(funky_runner);
      var x2 = baseId.charCodeAt(base_runner);
      funky_runner++;
      base_runner++;
      if (funky_runner == funkyId.length) funky_runner = 0;
      if (base_runner == baseId.length) base_runner = 0;
      var x3 = 0;
      if (flip === true) {
        x3 = ((x1 ^ 2.7) + (Math.log(x2) * 103));
        flip = false;
      } else {
        x3 = (Math.sin(x1) * 223) - x2 * 1.7;
        flip = true;
      }
      magic += `${x3}`;
      idxRun++;
    } while (idxRun < calcLen);
    return (magic.slice(1, magic.length + 1));
  }

}

module.exports = LicenseManager;
