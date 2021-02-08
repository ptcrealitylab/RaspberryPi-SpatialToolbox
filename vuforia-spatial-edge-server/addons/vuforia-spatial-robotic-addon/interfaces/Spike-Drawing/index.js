//Carter Silvey

var serial = require('./serial.js');
var server = require('@libraries/hardwareInterfaces');
var inverse = require('./inverseKinematics.js');
var settings = server.loadHardwareInterface(__dirname);

var TOOL_NAME = "spikeDraw"; // This is what is made on the webserver for the image target
let objectName = "spikeDrawNode"; // This is the name of the folder in spatialToolbox in Documents 

exports.enabled = settings('enabled');
exports.configurable = true;

let inMotion = false;                   // When robot is moving
let pathData = [];                      // List of paths with checkpoints
let activeCheckpointName = null;        // Current active checkpoint

var portLetters = ["A", "B", "C", "D", "E", "F"]
var ports = ["none", "none", "none", "none", "none", "none"]
var [motor1, motor2, motor3, distanceSensor, colorSensor, forceSensor] = ports
var firstMotor, secondMotor, thirdMotor
var runMotors = true

try {
    serial.openPort()
    setTimeout(() => {serial.sendFile('initialize.py')}, 10000) // CHANGED HERE --> Reverted the times back to original
    setTimeout(() => {serial.sendFile('functions.py')}, 13000) // CHANGED HERE --> Reverted the times back to original
    setTimeout(() => {initializePorts()}, 16000) // CHANGED HERE --> Reverted the times back to original
} catch(e) {
    console.log('Spike Prime NOT connected')
}

if (exports.enabled){
    // Code executed when your robotic addon is enabled
    setup();
    console.log('spikeDraw: Settings loaded: ', objectName)
    console.log("Spike is connected");

    // Sets up the settings that can be customized on localhost:8080
    function setup() {
        exports.settings = {
            // Name for the object
            spikeDrawName: { // CHANGED HERE --> Name is changed here 
                value: settings('objectName', objectName),
                type: 'text',
                default: objectName,
                disabled: false,
                helpText: 'The name of the object that connects to this hardware interface.'
            },
            // X distance from image target to first joint
            imageToBaseX: {
                value: settings('imageToBaseX', 0),
                type: 'number',
                default: 0,
                disabled: false,
                helpText: "The horizontal distance (in millimeters) from the center of the image target \
                to the center of the first rotating joint."
            },
            // Y distance from image target to first joint
            imageToBaseY: {
                value: settings('imageToBaseY', 0),
                type: 'number',
                default: 0,
                disabled: false,
                helpText: "The vertical distance (in millimeters) from the center of the image target \
                to the center of the first rotating joint."
            },
            // Length of the first linkage
            link1Length: {
                value: settings('link1Length', 0),
                type: 'number',
                default: 0,
                disabled: false,
                helpText: "The length (in millimeters) from the first rotating joint to the second rotating joint."
            },
            // Length of the second linkages
            link2Length: {
                value: settings('link2Length', 0),
                type: 'number',
                default: 0,
                disabled: false,
                helpText: "The length (in millimeters) from the second rotating joint to the end effector."
            }
        };
    }

    // Get the settings that the user defined on localhost:8080
    objectName = exports.settings.spikeDrawName.value;
    console.log("spikeDraw: " + objectName)
    imageToBaseX = exports.settings.imageToBaseX.value;
    imageToBaseY = exports.settings.imageToBaseY.value;
    link1Length = exports.settings.link1Length.value;
    link2Length = exports.settings.link2Length.value;

    if (link1Length != 0 && link2Length != 0) {
        inverse.setLengths(imageToBaseX, imageToBaseY, link1Length, link2Length);
    }

    server.addEventListener('reset', function () {
        settings = server.loadHardwareInterface(__dirname);
        setup();

        console.log('spikeDraw: Settings loaded: ', objectName);
    });
}

function startHardwareInterface() {
    console.log('spikeDraw: Starting up')

    server.enableDeveloperUI(true)

    console.log('spikeDraw: Setting default tool to drawing');
    server.setTool('spikeDraw', 'kineticAR', 'drawing', __dirname);
    server.removeAllNodes('spikeDraw', 'kineticAR');

    server.addNode("spikeDraw", "kineticAR", "kineticNode1", "storeData");     // Node for checkpoint stop feedback
    server.addNode("spikeDraw", "kineticAR", "kineticNode2", "storeData");     // Node for the data path. Follow Checkpoints
    server.addNode("spikeDraw", "kineticAR", "kineticNode4", "storeData");     // Node for cleaning the path

    server.addPublicDataListener("spikeDraw", "kineticAR", "kineticNode4","ClearPath",function (data) {

        console.log("spikeDraw:    -   -   -   Frame has requested to clear path: ", data);

        pathData.forEach(path => {
            path.checkpoints.forEach(checkpoint => {
                server.removeNode("spikeDraw", "kineticAR", checkpoint.name);
            });
            path.checkpoints = [];
        });
        pathData = [];

        server.pushUpdatesToDevices("spikeDraw");

        inMotion = false;
        activeCheckpointName = null;

    });

    server.addPublicDataListener("spikeDraw", "kineticAR", "kineticNode2","pathData",function (data){
        data.forEach(framePath => {             // We go through array of paths

            let pathExists = false;

            pathData.forEach(serverPath => {

                if (serverPath.index === framePath.index){   // If this path exists on the server, proceed to update checkpoints
                    pathExists = true;
                    
                    framePath.checkpoints.forEach(frameCheckpoint => {              // Foreach checkpoint received from the frame

                        let exists = false;
                        
                        serverPath.checkpoints.forEach(serverCheckpoint => {        // Check against each checkpoint stored on the server

                            if (serverCheckpoint.name === frameCheckpoint.name){    // Same checkpoint. Check if position has changed and update
                                
                                exists = true;

                                if (serverCheckpoint.posX !== frameCheckpoint.posX) serverCheckpoint.posX = frameCheckpoint.posX;
                                if (serverCheckpoint.posY !== frameCheckpoint.posY) serverCheckpoint.posY = frameCheckpoint.posY;
                                if (serverCheckpoint.posZ !== frameCheckpoint.posZ) serverCheckpoint.posZ = frameCheckpoint.posZ;
                                if (serverCheckpoint.posXUR !== frameCheckpoint.posXUR) serverCheckpoint.posXUR = frameCheckpoint.posXUR;
                                if (serverCheckpoint.posYUR !== frameCheckpoint.posYUR) serverCheckpoint.posYUR = frameCheckpoint.posYUR;
                                if (serverCheckpoint.posZUR !== frameCheckpoint.posZUR) serverCheckpoint.posZUR = frameCheckpoint.posZUR;
                                if (serverCheckpoint.orientation !== frameCheckpoint.orientation) serverCheckpoint.orientation = frameCheckpoint.orientation;

                                // <node>, <frame>, <Node>, x, y, scale, matrix
                                server.moveNode("spikeDraw", "kineticAR", frameCheckpoint.name, frameCheckpoint.posX, frameCheckpoint.posZ, 0.3,[
                                    1, 0, 0, 0,
                                    0, 1, 0, 0,
                                    0, 0, 1, 0,
                                    0, 0, frameCheckpoint.posY * 3, 1
                                ], true);
                                server.pushUpdatesToDevices("spikeDraw");

                                // Number and position of the current checkpoint in this loop
                                //let checkpointNumber = parseInt(frameCheckpoint.name.slice(-1));
                                //let checkpointPos = [frameCheckpoint.posX/1000, frameCheckpoint.posY/1000, frameCheckpoint.posZ/1000];

                                // If the checkpoint has already been added to Onshape, update its position
                                // if (checkpointNumber < onshapeCheckpoints) {
                                //     check.updateCheckpoint(checkpointNumber, checkpointPos, function(data){
                                //         //console.log(data);
                                //     });
                                // } 
                            }
                        });

                        // If the checkpoint is not in the server, add it and add the node listener.
                        if (!exists){
                            serverPath.checkpoints.push(frameCheckpoint);

                            server.addNode("spikeDraw", "kineticAR", frameCheckpoint.name, "node");

                            console.log('spikeDraw: NEW ' + frameCheckpoint.name + ' | position: ', frameCheckpoint.posX, frameCheckpoint.posY, frameCheckpoint.posZ);

                            // <node>, <frame>, <Node>, x, y, scale, matrix
                            server.moveNode("spikeDraw", "kineticAR", frameCheckpoint.name, frameCheckpoint.posX, frameCheckpoint.posZ, 0.3,[
                                1, 0, 0, 0,
                                0, 1, 0, 0,
                                0, 0, 1, 0,
                                0, 0, frameCheckpoint.posY * 3, 1
                            ], true);

                            server.pushUpdatesToDevices("spikeDraw");

                            console.log('spikeDraw: ************** Add read listener to ', frameCheckpoint.name);

                            // Add listener to node
                            server.addReadListener("spikeDraw", "kineticAR", frameCheckpoint.name, function(data){

                                let indexValues = frameCheckpoint.name.split("_")[1];
                                let pathIdx = parseInt(indexValues.split(":")[0]);
                                let checkpointIdx = parseInt(indexValues.split(":")[1]);
                                nodeReadCallback(data, checkpointIdx, pathIdx);

                            });

                            console.log(frameCheckpoint.posX/1000 + "," + frameCheckpoint.posY/1000 + "," + frameCheckpoint.posZ/1000)
                        }
                    });
                }
            });

            if (!pathExists){   // If the path doesn't exist on the server, add it to the server path data

                pathData.push(framePath);

            }
        });

        console.log("spikeDraw: Current PATH DATA in SERVER: ", JSON.stringify(pathData));

    });
}

function nodeReadCallback(data, checkpointIdx, pathIdx){

    // if the value of the checkpoint node changed to 1, we need to send the robot to that checkpoint
    // if the value of the checkpoint node changed to 0, the robot just reached the checkpoint and we can trigger other stuff

    console.log('NODE ', checkpointIdx, ' path: ', pathIdx, ' received ', data);

    let checkpointTriggered = pathData[pathIdx].checkpoints[checkpointIdx];

    if (data.value === 1){

        if (!checkpointTriggered.active){

            console.log('Checkpoint has changed from not active to active: ', checkpointTriggered.name);

            // Checkpoint has changed from not active to active. We have to send robot here
            activeCheckpointName = checkpointTriggered.name;
            checkpointTriggered.active = 1; // This checkpoint gets activated

            inMotion = true

            console.log(checkpointTriggered.posXUR)
            console.log(checkpointTriggered.posYUR)

            // Move the Spike Prime
            inverse.getAngles(checkpointTriggered.posXUR, -checkpointTriggered.posYUR, function(angles){
                angle1 = ((180/Math.PI * angles.q1)%360 + 360)%360
                angle2 = ((180/Math.PI * angles.q2)%360 + 360)%360
                console.log(angle1)
                console.log(angle2)

                setTimeout(() => { serial.writePort(motor1 + ".run_to_position(" + Math.round(angle1) + ", 'shortest path', 20)\r\n") }, 0);
                setTimeout(() => { serial.writePort(motor2 + ".run_to_position(" + Math.round(angle2) + ", 'shortest path', 20)\r\n") }, 1000);
                inMotion = false
                setTimeout(() => { server.write("spikeDraw", "kineticAR", activeCheckpointName, 0) }, 3000);
            });
            
            server.writePublicData("spikeDraw", "kineticAR", "kineticNode1", "CheckpointTriggered", checkpointIdx);          // Alert frame of new checkpoint goal

        } else {
            console.log('spikeDraw: WARNING - This checkpoint was already active!');
        }

    } else if (data.value === 0){   // If node receives a 0

        if (checkpointTriggered.active){

            console.log('Checkpoint has changed from active to not active: ', checkpointTriggered.name);

            if (inMotion){

                // The node has been deactivated in the middle of the move mission!
                // We need to delete the mission from the mission queue

                console.log('MISSION INTERRUPTED');

                // TODO: STOP UR

                ur_mission_interrupted = true;

            } else {    // Checkpoint has changed from active to not active, robot just got here. We have to trigger next checkpoint
                
                console.log('Checkpoint reached: ', checkpointTriggered.name);
                checkpointTriggered.active = 0; // This checkpoint gets deactivated

                server.writePublicData("spikeDraw", "kineticAR", "kineticNode1", "CheckpointStopped", checkpointIdx);

                let nextCheckpointToTrigger = null;

                if (checkpointIdx + 1 < pathData[pathIdx].checkpoints.length){                      // Next checkpoint in same path
                    nextCheckpointToTrigger = pathData[pathIdx].checkpoints[checkpointIdx + 1];

                    console.log('Next checkpoint triggered: ', nextCheckpointToTrigger.name);
                    server.write("spikeDraw", "kineticAR", nextCheckpointToTrigger.name, 1);

                } else {                                                                            // We reached end of path

                    activeCheckpointName = null;

                }
            }
        }
    }
}

// Gets the port ordering from the Spike Prime, which initialized itself
function initializePorts() {
    sensorData = readSensor()
    if (sensorData.includes('[') && sensorData.includes(',')) {
        sensorData = sensorData.substring(1, sensorData.length - 2)
        sensorData = sensorData.replace(/'/g, '')
        sensorData = sensorData.replace(/ /g, '')
        sensorData = sensorData.split(',')
        for (i = 0; i < sensorData.length; i++) {
            ports[i] = sensorData[i]
        }
        console.log(ports)
        definePorts()
    }
    else {
        setTimeout(() => { initializePorts(); }, 0);
    }
}

// Change the names of the motors and sensor to be their corresponding ports
// For example, a motor on port A is named "A"
function definePorts() {
    if (ports.indexOf('motor') != -1) {
        firstMotor = ports.indexOf('motor')
        motor1 = portLetters[firstMotor]
        if (ports.indexOf('motor', firstMotor + 1) != -1) {
            secondMotor = ports.indexOf('motor', firstMotor + 1)
            motor2 = portLetters[secondMotor]
            if (ports.indexOf('motor', secondMotor + 1) != -1) {
                thirdMotor = ports.indexOf('motor', secondMotor + 1)
                motor3 = portLetters[thirdMotor]
            }
        }
    }
    if (ports.indexOf('color') != -1) {
        colorSensor = portLetters[ports.indexOf('color')]
    }
    if (ports.indexOf('distance') != -1) {
        distanceSensor = portLetters[ports.indexOf('distance')]
    }
    if (ports.indexOf('force') != -1) {
        forceSensor = portLetters[ports.indexOf('force')]
    }
    console.log(motor1, motor2, motor3, colorSensor, distanceSensor, forceSensor)
}

function readSensor() {
    sensorData = serial.getSensor()
    return sensorData
}

// Send commands to stop all the motors
function stopMotors() {
    runMotors = false
    if (motor1 != "none") {
        serial.writePort(motor1 + ".stop()\r\n")
    }
    if (motor2 != "none") {
        serial.writePort(motor2 + ".stop()\r\n")
    }
    if (motor3 != "none") {
        serial.writePort(motor3 + ".stop()\r\n")
    }
}

server.addEventListener("reset", function () {

});

// Wait for the connection to be established with the Spike Prime before starting up
server.addEventListener("initialize", function () {
    if (exports.enabled) setTimeout(() => { startHardwareInterface() }, 20000)
});

// Stop motors on server shutdown
server.addEventListener("shutdown", function () {
    stopMotors()
});