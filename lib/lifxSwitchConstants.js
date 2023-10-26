'use strict';

module.exports = {
  // Energy Data By Product and Vendor ID
  SWITCH_DATA: {
    1: {
      70: { // LIFX Switch US
        "buttons": 4,
        "relays": 4,
        "levels": [
          0.37,
          0.68,
          0.96,
          1.27,
          1.6
        ] // power consumption of the device itself by # of pulled relays by index
      },
      71: { // LIFX Switch US
        "buttons": 4,
        "relays": 4,
        "levels": [
          0.37,
          0.68,
          0.96,
          1.27,
          1.6
        ] // power consumption of the device itself by # of pulled relays by index
      },
      89: { // LIFX Switch AU
        "buttons": 4,
        "relays": 4,
        "levels": [
          0.44,
          0.74,
          1.04,
          1.32,
          1.68
        ]
      }
    }
  }
};
