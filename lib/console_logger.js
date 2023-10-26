'use strict';

const Util = require('util');

class ConsoleLogger {

  Error() {
    if (this.LogErrors === false) return;
    this.__writeLog('err', arguments);
  }

  Warn() {
    if (this.LogWarnings === false) return;
    this.__writeLog('warn', arguments);
  }

  Log() {
    if (this.LogInfos === false) return;
    this.__writeLog('log', arguments);
  }

  __write(msgType, data) {
    if (msgType === 'err' || msgType === 'warn') {
      process.stderr.write(data);
    } else {
      process.stdout.write(data);
    }
  }
  __writeLog(msgType, args) {
    this.__write(msgType, this.__formatConsoleDate(new Date()).concat('[' + msgType + '] ', this.__scopeLabel));
    for (var i = 0; i < args.length; i++) {
      if (typeof args[i] === 'string') {
        if (i == args.length - 1) {
          if (msgType === 'err' || msgType === 'warn') {
            console.error(args[i]);
          } else {
            console.log(args[i]);
          }
        } else {
          this.__write(msgType, args[i]);
        }
      } else {
        if (i == args.length - 1) {
          if (msgType === 'err' || msgType === 'warn') {
            console.error(Util.inspect(args[i], false, 10, this.__logInColor));
          } else {
            console.log(Util.inspect(args[i], false, 10, this.__logInColor));
          }
        } else {
          this.__write(msgType, Util.inspect(args[i], false, 10, this.__logInColor));
        }
      }
    }
  }

  __formatConsoleDate(date) {
    var month = date.getMonth();
    var day = date.getDate();
    var hour = date.getHours();
    var minutes = date.getMinutes();
    var seconds = date.getSeconds();
    var milliseconds = date.getMilliseconds();
    return date.getFullYear() +
      '-' +
      ((month < 10) ? '0' + month : month) +
      '-' +
      ((day < 10) ? '0' + day : day) +
      ' ' +
      ((hour < 10) ? '0' + hour : hour) +
      ':' +
      ((minutes < 10) ? '0' + minutes : minutes) +
      ':' +
      ((seconds < 10) ? '0' + seconds : seconds) +
      '.' +
      ('00' + milliseconds).slice(-3) +
      ' ';
  }

  constructor(scopeName, logInColor) {
    this.__scopeLabel = '[' + scopeName + '] ';
    this.LogErrors = true;
    this.LogWarnings = true;
    this.LogInfos = true;
    if (process) {
      if (process.env) {
        if (process.env.DEBUG) {
          this.__logInColor = (process.env.DEBUG === '1') ? true : false;
        }
      }
    }
  }

}

module.exports = ConsoleLogger;
