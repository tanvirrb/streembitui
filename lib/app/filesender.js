﻿/*

This file is part of Streembit application. 
Streembit is an open source communication application. 

Streembit is a free software: you can redistribute it and/or modify it under the terms of the GNU General Public License 
as published by the Free Software Foundation, either version 3.0 of the License, or (at your option) any later version.

Streembit is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty 
of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License for more details.

You should have received a copy of the GNU General Public License along with Streembit software.  
If not, see http://www.gnu.org/licenses/.
 
-------------------------------------------------------------------------------------------------------------------------
Author: Tibor Zsolt Pardi 
Copyright (C) Streembit 2017
-------------------------------------------------------------------------------------------------------------------------

*/


(function () {
    const webrtcfile = require("webrtcfile");
    const peercomm = require("peercomm");
    const appevents = require("appevents");
    const Buffer = require('buffer').Buffer;
    const utilities = require('utilities');
    const util = require('util');

    function FileSender() {

        var handler = {

            dispose: function () {
            },

            oncomplete: function (hash) {
                // complete the task
                appevents.dispatch("on-task-event", "complete", "send", hash);
            },

            onerror: function (hash, err, param) {
                try {
                    appevents.error( 0x8200, err, param);
                    appevents.dispatch("on-task-event", "error", "send", hash, err);
                }
                catch (err) {
                    streembit.notify.error("Send  file VM onerror: %j", err, true)
                }
            },

            onsend: function (hash, value) {
                console.log("onsend value: " + value);
                appevents.dispatch("on-task-event", "update", "send", hash, value);
            },

            offer: function (params, callback) {
                var filename = params.file.name,
                    filesize = params.file.size,
                    filehash = params.filehash,
                    filetype = params.file.type;

                peercomm.ping(params.contact, true, 10000)
                .then(
                    function () {
                        return peercomm.get_contact_session(params.contact);
                    }
                ).then(
                    function () {
                        return peercomm.initfile(params.contact, filename, filesize, filehash, filetype, 50000)
                    }
               ).then(
                    function (isaccepted) {
                        console.log("File transfer init result: " + isaccepted);
                        if (isaccepted == true) {
                            callback();
                        }
                        else {
                            streembit.notify.error("The contact refused to accept the file");
                            appevents.dispatch("on-task-event", "close", "send", params.filehash);
                        }
                    }
                )
                .catch(function (err) {
                    streembit.notify.error("Error in starting file transfer: %j", err);
                    appevents.dispatch("on-task-event", "close", "send", params.filehash);
                });
            },

            initsend: function (params) {
                try {
                    if (!params || !params.file || !params.filehash || !params.file.size || !params.contact) {
                        return streembit.notify.error("Invalid send file parameters", null, true)
                    }

                    if (streembit.api.taskexists(params.filehash, params.contact.name)){
                        return alert("This file transfer task is currently in progress");
                    }

                    appevents.dispatch("on-task-event", "add", {
                        proc: "info",
                        type: "file",
                        mode: "send",
                        file_name: params.file.name,
                        taskid: params.filehash,
                        file_size: params.file.size,
                        contact: params.contact,
                        showconnect: true
                    });

                    handler.offer(params, function () {
                        try {
                            params.onsend = handler.onsend;
                            params.oncomplete = handler.oncomplete;
                            params.onerror = handler.onerror;

                            webrtcfile.sendfile(params);
                            //
                        }
                        catch (e) {
                            appevents.dispatch("on-task-event", "error", "send", params.filehash, e);
                            streembit.notify.error("Error in sending the file: " + e.message, null, true)
                        }
                    });
                }
                catch (e) {
                    appevents.dispatch("on-task-event", "error", "send", params.filehash, e);
                    streembit.notify.error("Error in sending the file: " + e.message, null, true);
                }
            },

            readfile: function (recipient) {
                try {

                    if (!window.FileReader) {
                        return alert('FileReader API is not supported by your browser.');
                    }

                    var $i = $('#fileInput'), input = $i[0];
                    if (!input.files || !input.files.length) {
                        return alert("File not selected or browser incompatible.");
                    }

                    var file = input.files[0]; // The file  
                    if (file.size === 0) {
                        return alert('File is empty, please select a non-empty file');
                    }

                    if (!file.type) {                        
                        file.type = "text/plain";
                    }

                    var params = {
                        file: 0,
                        filehash: "",
                        is_sender: true,
                        contact: recipient
                    };

                    var blobSlice = File.prototype.slice || File.prototype.mozSlice || File.prototype.webkitSlice,
                        chunkSize = 8192, // Read in chunks of 8 KB
                        chunks = Math.ceil(file.size / chunkSize),
                        currentChunk = 0,
                        array = [];
                        fileReader = new FileReader();

                        fileReader.onload = function (e) {
                            try {
                                console.log('read chunk No. ', currentChunk + 1, 'of', chunks);

                                // to hav a similar buffer for hash as we have at the receiver end
                                // where the base64 convert method creates Uint8Array chunks from the data
                                var uintarr = new Uint8Array(e.target.result);
                                array.push(uintarr);
                                currentChunk++;

                                if (currentChunk < chunks) {
                                    loadNext();
                                }
                                else {
                                    console.log('finished loading, compute hash');
                                    params.file = file;
                                    
                                    var buffer = Buffer.from(array);
                                    // Compute hash
                                    crypto.subtle.digest("SHA-1", buffer).then((result) => {
                                        var hash = utilities.arrayBufferToHex(result);
                                        params.filehash = hash;

                                        // call the file sender 
                                        return handler.initsend(params);
                                    });
                                }
                            }
                            catch (e) {
                                streembit.notify.error("Error in reading the file: " + e.message);
                            }
                        };

                        fileReader.onerror = function () {
                            alert('Error in reading the file and computing the file hash.');
                        };

                        function loadNext() {
                            var start = currentChunk * chunkSize,
                                end = ((start + chunkSize) >= file.size) ? file.size : start + chunkSize;

                            fileReader.readAsArrayBuffer(blobSlice.call(file, start, end));
                        }

                        loadNext();

                }
                catch (e) {
                    streembit.notify.error("Error in reading the file: " + e.message);
                }
            },

            run: function (recipient) {

                var content = $("#send-file-template").html();
                var box = bootbox.dialog({
                    message: content,
                    title: "Send File",
                    closeButton: false,
                    buttons: {
                        danger: {
                            label: "Cancel",
                            className: 'btn-default',
                            callback: function () {
                            }
                        },
                        success: {
                            label: "Send",
                            className: 'btn-default',
                            callback: function () {
                                handler.readfile(recipient);
                            }
                        }
                    }
                });

                box.init(function () {
                    $(".modal-header").css("padding", "4px 8px 4px 12px");
                });
            }
        };

        return handler;
    }

    module.exports = FileSender;

})();
