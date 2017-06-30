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
    var cmd = __dirname + '/flux_led.py ' + this.ip + ' ' + command;
    this.log(cmd);
	exec(cmd, callback);
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

MagicHomeAccessory.prototype.setToCurrentColor = function() {
    var color = this.color;


    //Setting both Saturation and Hue to 0 will turn on warm white
    if (color.S == 0 && color.H == 0 && this.purewhite) {
        this.setToWarmWhite();
        return
    }
    //Asking siri to set color to "snow" will turn on cold white
    else if (color.S == 2 && color.H == 0 && this.purewhite) {
        this.setToColdWhite();
        return
    }

    //Asking siri to set color to "cream" will turn on warm white
    else if (color.S == 18 && color.H == 57 && this.purewhite) {
        this.setToWarmWhite();
        return
    }
    
    //If the selection reticle is located on the left half of the color wheel with less than 25 saturation (halfway towards the center) cold white will turn on
    else if (color.S < 25 && color.H > 90 && color.H < 270 && this.purewhite) {
        this.setToColdWhite();
        return
    }

    //If the selection reticle is located on the right half of the color wheel with less than 25 saturation (halfway towards the center) warm white will turn on
    else if (color.S < 25 && ((color.H > 0 && color.H < 90) || (color.H > 270 && color.H < 360)) && this.purewhite) {
        this.setToWarmWhite();
        return
	}

	var brightness = this.brightness;
	var converted = convert.hsl.rgb([color.H, color.S, color.L]);

    var base = '-x ' + this.setup + ' -c';
	this.sendCommand(base + Math.round((converted[0] / 100) * brightness) + ',' + Math.round((converted[1] / 100) * brightness) + ',' + Math.round((converted[2] / 100) * brightness));
};

MagicHomeAccessory.prototype.setToWarmWhite = function() {
    var brightness = this.brightness;
    this.sendCommand('-x ' + this.setup + ' -w' + brightness);
};

MagicHomeAccessory.prototype.setToColdWhite = function() {
    var brightness = this.brightness;
    this.sendCommand('-x ' + this.setup + ' -z' + brightness);
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
