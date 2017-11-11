'use strict';

var convert = require('color-convert');

var Characteristic, Service;

module.exports = function(homebridge){
    console.log("homebridge API version: " + homebridge.version);

    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;

    homebridge.registerAccessory('homebridge-magichome', 'MagicHome', MagicHomeAccessory, false);
};

function MagicHomeAccessory(log, config, api) {

	this.log = log;
	this.config = config;
	this.name = config.name || 'LED Controller';
    this.setup = config.setup || 'RGBW';
	this.port = config.port || 5577;
	this.ip = config.ip;
	this.color = {H: 255, S:100, L:50};
	this.brightness = 100;
    this.purewhite = config.purewhite || false;
	this.onlywhite = config.onlywhite || false;
	this.combinedwhite = config.combinedwhite || false;
	this.getColorFromDevice();

}

MagicHomeAccessory.prototype.identify = function(callback) {
	this.log('Identify requested!');
    callback();
};

MagicHomeAccessory.prototype.getServices = function() {
	var informationService = new Service.AccessoryInformation();

    informationService
        .setCharacteristic(Characteristic.Manufacturer, 'ACME Ltd.')
        .setCharacteristic(Characteristic.Model, 'LED-controller')
        .setCharacteristic(Characteristic.SerialNumber, '123456789');

    var lightbulbService = new Service.Lightbulb(this.name);

    lightbulbService
        .getCharacteristic(Characteristic.On)
        .on('get', this.getPowerState.bind(this))
        .on('set', this.setPowerState.bind(this));

    lightbulbService
        .addCharacteristic(new Characteristic.Hue())
        .on('get', this.getHue.bind(this))
        .on('set', this.setHue.bind(this));

    lightbulbService
        .addCharacteristic(new Characteristic.Saturation())
        .on('get', this.getSaturation.bind(this))
        .on('set', this.setSaturation.bind(this));

	lightbulbService
        .addCharacteristic(new Characteristic.Brightness())
        .on('get', this.getBrightness.bind(this))
        .on('set', this.setBrightness.bind(this));

    return [informationService, lightbulbService];

};

// MARK: - UTIL

MagicHomeAccessory.prototype.sendCommand = function(command, callback) {
	var exec = require('child_process').exec;
	var cmd =  __dirname + '/flux_led.py ' + this.ip + ' ' + command;
	exec(cmd, callback);
        //this.log("Sent command: %s", cmd);
};

MagicHomeAccessory.prototype.getState = function (callback) {
	this.sendCommand('-i', function(error, stdout) {
		var settings = {
			on: false,
			color: {H: 255, S: 100, L: 50}
		};

		var colors = stdout.match(/\(\d{3}\, \d{3}, \d{3}\)/g);
		var isOn = stdout.match(/\] ON /g);

		if(isOn && isOn.length > 0) settings.on = true;
		if(colors && colors.length > 0) {
			var converted = convert.rgb.hsl(stdout.match(/\d{3}/g));
			settings.color = {
				H: converted[0],
				S: converted[1],
				L: converted[2],
			};
		}

		callback(settings);

	});
};

MagicHomeAccessory.prototype.getColorFromDevice = function() {
	this.getState(function(settings) {
		this.color = settings.color;
		this.log("DEVICE COLOR: %s", settings.color.H+','+settings.color.S+','+settings.color.L);
	}.bind(this));
};

// Behaviour:
// On RGB: std rgb // onlywhite: disabled for this setup
// On RGBW: std: rgb // combinedwhite: std + white is controlled by brightness // onlywhite: white channel will be controlled by brightness
// On RGBWW: std: rgb // combinedwhite: std + both whites are controlled by brightness // onlywhite: Only ww and cw channel is active ww/cw are controlled by color temperature
MagicHomeAccessory.prototype.setToCurrentColor = function() {
	var color = this.color;
	var base = '-x ' + this.setup + ' -V';
	var brightness = this.brightness;
	var ww=Math.round(brightness/100*255); // brightness is 0...100
	var cw=Math.round(brightness/100*255);
	//console.log("reuest: " + color.H +"/"+color.S+"/"+color.L+"/"+brightness);
	if(this.setup =="RGBW" && this.onlywhite){ // onlywhite on rgbw (only set white channel to brightness)
		this.sendCommand(base + '0,0,0,' + ww + ',0');

	}else if(this.setup =="RGBWW" && this.onlywhite){ // onlywhite on rgbww (controlling white tone depending on color)
		var converted = convert.hsl.rgb([color.H, color.S, color.L]);
		var r=converted[0];
		var g=converted[1];
		var b=converted[2];
		//console.log("reuest(rgb): " + r +"/"+g+"/"+b+"/"+brightness);
		//defining color vectors for ww and cw
		var wred=223; //maximum value of red for warm colors
		var cred=98; //minimum value of red for cold colors
		var fac=(r-cred)/(wred-cred); // assume linear degradation between red values
		fac=Math.max(0.0,Math.min(1.0,fac));
		//brightness will be adjusted  that sum of both matches brightnessvalue (does not yield maximum power output, but brightness doesn't vary)
		ww=Math.round(fac*brightness*2.55);
		cw=Math.round((1-fac)*brightness*2.55);
		this.sendCommand(base + '0,0,0,' + ww + ','+cw);

	}else{ // std behaviour same for all
        	var converted = convert.hsl.rgb([color.H, color.S, color.L]);
		var r=Math.round((converted[0] / 100) * brightness);
		var g=Math.round((converted[1] / 100) * brightness);
		var b=Math.round((converted[2] / 100) * brightness);
		if(this.combinedwhite){// set value for all channels, including white
			this.sendCommand(base + r + ',' + g + ',' + b + ',' + ww + ',' +cw);
		}else{
			if(color.S == 0 && color.H == 0 && this.purewhite) { //control brightness of white channel if white value is selected and option enabled
				this.sendCommand(base + '0,0,0,' + ww + ','+cw);
			}else{ //modify only rgb values and preserve white
				var base = '-x ' + this.setup + ' -c';
				this.sendCommand(base + r + ',' + g + ',' + b);
			}
		}
	}
	return
};

MagicHomeAccessory.prototype.setToWarmWhite = function() {
    var brightness = this.brightness;
    this.sendCommand('-w ' + brightness);
};

// MARK: - POWERSTATE

MagicHomeAccessory.prototype.getPowerState = function(callback) {
	this.getState(function(settings) {
		callback(null, settings.on);
	});
};

MagicHomeAccessory.prototype.setPowerState = function(value, callback) {
	this.sendCommand(value ? '--on' : '--off', function() {
		callback();
	});
};


// MARK: - HUE

MagicHomeAccessory.prototype.getHue = function(callback) {
	var color = this.color;
	callback(null, color.H);
};

MagicHomeAccessory.prototype.setHue = function(value, callback) {
	this.color.H = value;
	this.setToCurrentColor();
	this.log("HUE: %s", value);

	callback();
};

// MARK: - BRIGHTNESS

MagicHomeAccessory.prototype.getBrightness = function(callback) {
	var brightness = this.brightness;
	callback(null, brightness);
};

MagicHomeAccessory.prototype.setBrightness = function(value, callback) {
	this.brightness = value;
	this.setToCurrentColor();
	this.log("BRIGHTNESS: %s", value);
	callback();
};

// MARK: - SATURATION

MagicHomeAccessory.prototype.getSaturation = function(callback) {
	var color = this.color;
	callback(null, color.S);
};

MagicHomeAccessory.prototype.setSaturation = function(value, callback) {
	this.color.S = value;
	this.setToCurrentColor();
	this.log("SATURATION: %s", value);

	callback();
};
