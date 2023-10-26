# LIFX LANv2

Adds local network support for LIFX devices to Homey.
Homey is a product from Athom: https://homey.app
Primary LIFX API: https://lan.developer.lifx.com/docs
Products Data: https://github.com/LIFX/products

App Store Version: https://homey.app/a/com.sdn.lifx-lan2
Homey Community Forum: https://community.athom.com/t/lifx-lan/24970

Old public project [wiki](https://github.com/Shakesbeard/com.sdn.lifx-lan2/wiki) for details.

Rewrite:
 - BLOCKED: Add device repair code to update icon? Requires Homey 4.1.0 or higher. Does not look like it supports icon update
 - Update LIFX Client Library to add LAN Chain Device Control
    - Add Pixel Effects for Chain Devices

LIFX Switch:
 - Add dim level changed event
 - Add dim level capabilities
 - Add dim level global flow token
 - Add set dim level action card 
 - Add set relative dim level action card
 - Add support for buttons if ever anything available for those in specific
 - Add support for per relay power measuring protocol
 - Add events & emits for per relay power consumption changes
 - Add events & emits for overall power consumption changes
 - Add flow tokens per relay for power consumption along the power measuring protocol

PID Info:
ID 70 and 71 are essentially the same product, with some slight mechanical tweaks. In function and performance, it’s exactly the same.

In the long term I expect these to be replaced with pid 89 (Switch Glass sold into AU region), pid 115 (Switch Glass sold into US region). On paper, all 4 PIDs here are basically the same product, and soon we will start to sell 2-Gang Glass Switches which will be under the same PID (I’ll follow up how you can tell if a single PID is 4 Gang or 2 Gang..)
