import {Map} from "./Map.js";
import {ViewerIFCObjectColors} from "./IFCObjectDefaults/ViewerIFCObjectColors.js";
import {
    Viewer,
    BCFViewpointsPlugin,
    math,
    FastNavPlugin,
	StoreyViewsPlugin,
	ObjectsMemento,
	ModelMemento,
	Mesh, Node, PhongMaterial, buildBoxGeometry, ReadableGeometry,
	AnnotationsPlugin,
	CameraMemento, Skybox
	

	
} from "@xeokit/xeokit-sdk/dist/xeokit-sdk.es.js";


/** @private */
class Controller {

    /**
     * @protected
     */
    constructor(parent, cfg, server, viewer) {

        this.bimViewer = (parent ? (parent.bimViewer || parent) : this);
        this.server = parent ? parent.server : server;
        this.viewer = parent ? parent.viewer : viewer;

		this.objectsMemento = null;
		this.modelMemento = null;
		this.originalMeshes = null;
		this.lastViewPoint = null;
		this.xOrientation = null;
		this.yOrientation = null;
        this._children = [];
		this.timerAnnot = null;

        if (parent) {
            parent._children.push(this);
        }

        this._subIdMap = null; // Subscription subId pool
        this._subIdEvents = null; // Subscription subIds mapped to event names
        this._eventSubs = null; // Event names mapped to subscribers
        this._events = null; // Maps names to events
        this._eventCallDepth = 0; // Helps us catch stack overflows from recursive events

        this._enabled = null; // Used by #setEnabled() and #getEnabled()
        this._active = null; // Used by #setActive() and #getActive()
		
    }

    /**
     * Fires an event on this Controller.
     *
     * @protected
     *
     * @param {String} event The event type name
     * @param {Object} value The event parameters
     * @param {Boolean} [forget=false] When true, does not retain for subsequent subscribers
     */
    fire(event, value, forget) {
        if (!this._events) {
            this._events = {};
        }
        if (!this._eventSubs) {
            this._eventSubs = {};
        }
        if (forget !== true) {
            this._events[event] = value || true; // Save notification
        }
        const subs = this._eventSubs[event];
        let sub;
        if (subs) { // Notify subscriptions
            for (const subId in subs) {
                if (subs.hasOwnProperty(subId)) {
                    sub = subs[subId];
                    this._eventCallDepth++;
                    if (this._eventCallDepth < 300) {
                        sub.callback.call(sub.scope, value);
                    } else {
                        this.error("fire: potential stack overflow from recursive event '" + event + "' - dropping this event");
                    }
                    this._eventCallDepth--;
                }
            }
        }
    }

    /**
     * Subscribes to an event on this Controller.
     *
     * The callback is be called with this component as scope.
     *
     * @param {String} event The event
     * @param {Function} callback Called fired on the event
     * @param {Object} [scope=this] Scope for the callback
     * @return {String} Handle to the subscription, which may be used to unsubscribe with {@link #off}.
     */
    on(event, callback, scope) {
        if (!this._events) {
            this._events = {};
        }
        if (!this._subIdMap) {
            this._subIdMap = new Map(); // Subscription subId pool
        }
        if (!this._subIdEvents) {
            this._subIdEvents = {};
        }
        if (!this._eventSubs) {
            this._eventSubs = {};
        }
        let subs = this._eventSubs[event];
        if (!subs) {
            subs = {};
            this._eventSubs[event] = subs;
        }
        const subId = this._subIdMap.addItem(); // Create unique subId
        subs[subId] = {
            callback: callback,
            scope: scope || this
        };
        this._subIdEvents[subId] = event;
        const value = this._events[event];
        if (value !== undefined) { // A publication exists, notify callback immediately
            callback.call(scope || this, value);
        }
        return subId;
    }

    /**
     * Cancels an event subscription that was previously made with {@link Controller#on} or {@link Controller#once}.
     *
     * @param {String} subId Subscription ID
     */
    off(subId) {
        if (subId === undefined || subId === null) {
            return;
        }
        if (!this._subIdEvents) {
            return;
        }
        const event = this._subIdEvents[subId];
        if (event) {
            delete this._subIdEvents[subId];
            const subs = this._eventSubs[event];
            if (subs) {
                delete subs[subId];
            }
            this._subIdMap.removeItem(subId); // Release subId
        }
    }

    /**
     * Subscribes to the next occurrence of the given event, then un-subscribes as soon as the event is handled.
     *
     * This is equivalent to calling {@link Controller#on}, and then calling {@link Controller#off} inside the callback function.
     *
     * @param {String} event Data event to listen to
     * @param {Function} callback Called when fresh data is available at the event
     * @param {Object} [scope=this] Scope for the callback
     */
    once(event, callback, scope) {
        const self = this;
        const subId = this.on(event,
            function (value) {
                self.off(subId);
                callback.call(scope || this, value);
            },
            scope);
    }

    /**
     * Logs a console debugging message for this Controller.
     *
     * The console message will have this format: *````[LOG] [<component type> <component id>: <message>````*
     *
     * @protected
     *
     * @param {String} message The message to log
     */
    log(message) {
        message = "[LOG] " + message;
        window.console.log(message);
    }

    /**
     * Logs a warning for this Controller to the JavaScript console.
     *
     * The console message will have this format: *````[WARN] [<component type> =<component id>: <message>````*
     *
     * @protected
     *
     * @param {String} message The message to log
     */
    warn(message) {
        message = "[WARN] " + message;
        window.console.warn(message);
    }

    /**
     * Logs an error for this Controller to the JavaScript console.
     *
     * The console message will have this format: *````[ERROR] [<component type> =<component id>: <message>````*
     *
     * @protected
     *
     * @param {String} message The message to log
     */
    error(message) {
        message = "[ERROR] " + message;
        window.console.error(message);
    }

    _mutexActivation(controllers) {
        const numControllers = controllers.length;
        for (let i = 0; i < numControllers; i++) {
            const controller = controllers[i];
            controller.on("active", (function () {
                const _i = i;
                return function (active) {
                    if (!active) {
                        return;
                    }
                    for (let j = 0; j < numControllers; j++) {
                        if (j === _i) {
                            continue;
                        }
                        controllers[j].setActive(false);
                    }
                };
            })());
        }
    }

    /**
     * Enables or disables this Controller.
     *
     * Fires an "enabled" event on update.
     *
     * @protected
     * @param {boolean} enabled Whether or not to enable.
     */
    setEnabled(enabled) {
        if (this._enabled === enabled) {
            return;
        }
        this._enabled = enabled;
        this.fire("enabled", this._enabled);
    }

    /**
     * Gets whether or not this Controller is enabled.
     *
     * @protected
     *
     * @returns {boolean}
     */
    getEnabled() {
        return this._enabled;
    }

    /**
     * Activates or deactivates this Controller.
     *
     * Fires an "active" event on update.
     *
     * @protected
     *
     * @param {boolean} active Whether or not to activate.
     */
    setActive(active) {
        if (this._active === active) {
            return;
        }
        this._active = active;
        this.fire("active", this._active);
    }

    /**
     * Gets whether or not this Controller is active.
     *
     * @protected
     *
     * @returns {boolean}
     */
    getActive() {
        return this._active;
    }

    /**
     * Destroys this Controller.
     *
     * @protected
     *
     */
    destroy() {
        if (this.destroyed) {
            return;
        }
        /**
         * Fired when this Controller is destroyed.
         * @event destroyed
         */
        this.fire("destroyed", this.destroyed = true);
        this._subIdMap = null;
        this._subIdEvents = null;
        this._eventSubs = null;
        this._events = null;
        this._eventCallDepth = 0;
        for (let i = 0, len = this._children.length; i < len; i++) {
            this._children[i].destroy();
        }
        this._children = [];
    }
	
	decode(str,encode ) { //mettre une condition à décode : vérifier que la chaine est encodée avant de décode !

	if(str)
	{ 
		var chars = {"encode":{"É":"00C9","²":"00B2","³":"00B3","°":"00B0","À":"00C0","à":"00E0","Á":"00C1","á":"00E1","Â":"00C2","â":"00E2","Ã":"00C3","ã":"00E3","Ä":"00C4","ä":"00E4","Å":"00C5","å":"00E5","Æ":"00C6","æ":"00E6","Ç":"00C7","ç":"00E7","Ð":"00D0","ð":"00F0","È":"00C8","è":"00E8","É":"00C9","é":"00E9","Ê":"00CA","ê":"00EA","Ë":"00CB","ë":"00EB","Ì":"00CC","ì":"00EC","Í":"00CD","í":"00ED","Î":"00CE","î":"00EE","Ï":"00CF","ï":"00EF","Ñ":"00D1","ñ":"00F1","Ò":"00D2","ò":"00F2","Ó":"00D3","ó":"00F3","Ô":"00D4","ô":"00F4","Õ":"00D5","õ":"00F5","Ö":"00D6","ö":"00F6","œ":"0153","Œ":"0152","Ø":"00D8","ø":"00F8","ß":"00DF","Ù":"00D9","ù":"00F9","Ú":"00DA","ú":"00FA","Û":"00DB","û":"00FB","Ü":"00DC","ü":"00FC","Ý":"00DD","ý":"00FD","Þ":"00DE","þ":"00FE","Ÿ":"0178","ÿ":"00FF"},"decode":{"00C9":"É","00B2":"²","00B3":"³","00B0":"°","00C0":"À","00E0":"à","00C1":"Á","00E1":"á","00C2":"Â","00E2":"â","00C3":"Ã","00E3":"ã","00C4":"Ä","00E4":"ä","00C5":"Å","00E5":"å","00C6":"Æ","00E6":"æ","00C7":"Ç","00E7":"ç","00D0":"Ð","00F0":"ð","00C8":"È","00E8":"è","00C9":"É","00E9":"é","00CA":"Ê","00EA":"ê","00CB":"Ë","00EB":"ë","00CC":"Ì","00EC":"ì","00CD":"Í","00ED":"í","00CE":"Î","00EE":"î","00CF":"Ï","00EF":"ï","00D1":"Ñ","00F1":"ñ","00D2":"Ò","00F2":"ò","00D3":"Ó","00F3":"ó","00D4":"Ô","00F4":"ô","00D5":"Õ","00F5":"õ","00D6":"Ö","00F6":"ö","0153":"œ","0152":"Œ","00D8":"Ø","00F8":"ø","00DF":"ß","00D9":"Ù","00F9":"ù","00DA":"Ú","00FA":"ú","00DB":"Û","00FB":"û","00DC":"Ü","00FC":"ü","00DD":"Ý","00FD":"ý","00DE":"Þ","00FE":"þ","0178":"Ÿ","00FF":"ÿ"}};
		str = str.toString();
		var temp = "";
		if (encode)
		{
			for (var i= 0; i<str.length; i++)
			{
				if (chars.encode[str[i]])
				{
					temp += "\\X2\\" +chars.encode[str[i]]+"\\X0\\";
				}
				else 
					temp += str[i];
			}
			return temp.replace("'", "''"); //temp.replace(new RegExp("'","g"), "''");
		}
		else{
			str = str.replace("''", "'");//str.replace(new RegExp("''","g"), "'");
			str = str.replace(new RegExp(this.escapeRegExp("\\\\X2\\\\"),"g"), "#dyn#");
			str = str.replace(new RegExp(this.escapeRegExp("\\\\X0\\\\"),"g"), "#fyn#");
			str = str.replace(new RegExp(this.escapeRegExp("\\X2\\"),"g"), "#dyn#");
			str = str.replace(new RegExp(this.escapeRegExp("\\X0\\"),"g"), "#fyn#");
			str =str.replace(new RegExp("#dyn#([a-zA-Z0-9_]{4})#fyn#","g"),function (x) { 
			return chars.decode[x.replace("#dyn#","").replace("#fyn#","")] ? chars.decode[x.replace("#dyn#","").replace("#fyn#","")] : x.replace("#dyn#","\\X2\\").replace("#fyn#","\\X0\\");
			});
			return  str;
		}
	} else return "";
	
    
	}
	 escapeRegExp(string) {
		return string.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, "\\$1");
	}

	deselectAll(){
		var objects = this.viewer.scene.objects;
		console.time("deselectAll")
		for(var a in objects){
			objects[a].selected = false; // reset selected
		}
	}
	
	selectObject() {
			window.removeEventListener("dblclick",this.handleDblClick.bind(this));

			window.addEventListener("dblclick",this.handleDblClick.bind(this),false);
			var lastEntity = null;
			var lastColorize = null;
			var lastMeshes = null;
			console.log("SelectObject,this.viewer",this.viewer);
			this.viewer.cameraControl.on("picked", (pickResult) => { //déclaration d'un event listener qui se repete au clique sur un objet
				this.deselectAll();

				//var modelId = this.viewer.scene._modelIds[0];
				console.log("lastEntityyyyyyyyyyyyyyyy",lastEntity);
				console.log("pickResult",pickResult);
				if (!pickResult.entity) {
					console.log(lastEntity);
					return;
				}
				if(!this.isAnnotationsEnabled || this.isAnnotationsEnabled == undefined)
					this.showObjectProperties(pickResult.entity.id,true);
				console.log("entity=>",pickResult.entity);
				/*if (document.referrer != "")
					
					window.parent.postMessage(["onSelectObjectBim",pickResult.entity.id], document.referrer); */
				

				if (!lastEntity || pickResult.entity.id !== lastEntity.id) {

					if (lastEntity) {
						lastEntity.selected = false;
					}

					lastEntity = pickResult.entity;
					lastColorize = pickResult.entity.colorize ? pickResult.entity.colorize.slice() : null;
					lastMeshes = pickResult.entity.meshes ? pickResult.entity.meshes.slice() : null;
					console.log("entity.meshes", pickResult.entity.meshes)
		
					
					lastEntity.selected = true;

					
					var viewer = this.viewer; 
					
					var metaObject = viewer.metaScene.metaObjects[pickResult.entity.id];
				
					
					var o = new Object();
					o.id = metaObject.id;
					o.propertySets = metaObject.propertySets;
					o.name = this.decode(metaObject.name);
					o.parentId = metaObject.parent.id;
					o.parentName = this.decode(metaObject.parent.name);
					o.parentType = metaObject.parent.type;
					o.ifcId = lastEntity.model.id;
					console.log(metaObject);
					var currentO = metaObject;
					while(currentO != null)
					{
						if(currentO.type == "IfcBuilding")
						{
							o.bat = currentO.name;
							currentO = null;
						}
						else
							currentO = currentO.parent;
							
					}
					//solveCircularStructure
					for(var i in o.propertySets ){
						if(o.propertySets[i]){
							delete o.propertySets[i].metaModels;
						}
					}
					window.lastEntity = o;
					if (document.referrer != "")			 
						window.parent.postMessage(["onSelectObjectBim",this.decode(JSON.stringify(o))], document.referrer); 

					setTimeout(() => {
						window.removeEventListener("dblclick",this.handleDblClick.bind(this));
						window.lastEntity = null;
					}, 200);
					
				}
			});

			this.viewer.cameraControl.on("pickedNothing", () => {
				if (lastEntity) {
					lastEntity.selected = false;
					lastEntity = null;
				}
				if (document.referrer != "")			 
					window.parent.postMessage(["unselectObjectBIM"], document.referrer); 
			});

			
	}
	
		uniqueObject(o){
		var id = o.id;
		for (var i in o._aabb)
		{
			id += "_"+o._aabb[i];
		}
		return o.id;
	}
	 getCircularReplacer(){
		  const seen = new WeakSet();
		  return (key, value) => {
			if (typeof value === 'object' && value !== null) {
			  if (seen.has(value)) {
				return;
			  }
			  seen.add(value);
			}
			return value;
		  };
		}

	/* get2D(pickResult){
		var viewer = this.viewer; 
		var idParent = "";
		if (viewer.metaScene.metaObjects[pickResult.entity.id].parent && viewer.metaScene.metaObjects[pickResult.entity.id].parent.type == "IfcBuildingStorey")
		{
			
			
			const storeyViewsPlugin = new StoreyViewsPlugin(this.viewer);
			// Make all doors transparent
			viewer.scene.setObjectsOpacity(viewer.metaScene.getObjectIDsByType("IfcDoor"), 0.3);
		
			idParent = viewer.metaScene.metaObjects[pickResult.entity.id].parent.id;
			console.log(idParent);
			storeyViewsPlugin.showStoreyObjects(idParent, {
				hideOthers: true,
				useObjectStates: false
			});

			storeyViewsPlugin.gotoStoreyCamera(idParent, {
				projection: "ortho"
			});

			const storeyMap = storeyViewsPlugin.createStoreyMap(idParent, {
				format: "png",
				width: 380,
				useObjectStates: true
			});

			const img = document.createElement("img");
			img.src = storeyMap.imageData;
			img.id = "storeyMapImg";
			img.style.width = storeyMap.width + "px";
			img.style.height = storeyMap.height + "px";
			img.style.padding = "0";
			img.style.margin = "0";

			const storeyMapDiv = document.getElementById("storeyMap");
			const oldImg = document.getElementById("storeyMapImg");
			if (oldImg)
			storeyMapDiv.replaceChild(img,oldImg);
			else
			storeyMapDiv.appendChild(img);

			const pointer = document.createElement("div");
			pointer.id = "planPointer";
			pointer.style.width = "60px";
			pointer.style.height = "60px";
			pointer.style.position = "absolute";
			pointer.style["z-index"] = 100000;
			pointer.style.left = "0px";
			pointer.style.top = "0px";
			pointer.style.cursor = "none";
			pointer.style["pointer-events"] = "none";
			pointer.style.transform = "rotate(0deg)";
			pointer.style.visibility = "hidden";
			const oldPointer = document.getElementById("planPointer");
			if (oldPointer)
			storeyMapDiv.parentElement.replaceChild(pointer,oldPointer);
			else
			storeyMapDiv.parentElement.appendChild(pointer);

			const canStandOnTypes = {
				IfcSlab: true,
				IfcStair: true,
				IfcFloor: true,
				IfcFooting: true
			};

			img.onmouseenter = (e) => {
				img.style.cursor = "default";
			};

			img.onmousemove = (e) => {

				img.style.cursor = "default";

				const imagePos = [e.offsetX, e.offsetY];
				

				const pickResult = storeyViewsPlugin.pickStoreyMap(storeyMap, imagePos, {});
				console.log(pickResult);
				if (pickResult) {

					const entity = pickResult.entity;
					const metaObject = viewer.metaScene.metaObjects[entity.id];

					if (metaObject) {
						if (canStandOnTypes[metaObject.type]) {
							img.style.cursor = "pointer";
						}
					}
				}
			};

			img.onmouseleave = (e) => {
				img.style.cursor = "default";
			};

			const worldPos = math.vec3();

			img.onclick = (e) => {
				const imagePos = [e.offsetX, e.offsetY];
				const pickResult = storeyViewsPlugin.pickStoreyMap(storeyMap, imagePos, {
					pickSurface: true
				});
				
				if (pickResult) {

					worldPos.set(pickResult.worldPos);

					// Set camera vertical position at the mid point of the storey's vertical
					// extents - note how this is adapts to whichever of the X, Y or Z axis is
					// designated the World's "up" axis

					const camera = viewer.scene.camera;
					const idx = camera.xUp ? 0 : (camera.yUp ? 1 : 2); // Find the right axis for "up"
					const storey = storeyViewsPlugin.storeys[storeyMap.storeyId];
					worldPos[idx] = (storey.aabb[idx] + storey.aabb[3 + idx]) / 2;
					console.log(worldPos);

					viewer.cameraFlight.flyTo({
						eye: worldPos,
						up: viewer.camera.worldUp,
						look: math.addVec3(worldPos, viewer.camera.worldForward, []),
						projection: "perspective",
						duration: 1.5
					}, () => {
						viewer.cameraControl.navMode = "firstPerson";
					});
				} else {
					storeyViewsPlugin.gotoStoreyCamera(idParent, {
						projection: "ortho",
						duration: 1.5,
						done: () => {
							viewer.cameraControl.navMode = "planView"
						}
					});
				}
			};

			const imagePos = math.vec2();
			const worldDir = math.vec3();
			const imageDir = math.vec2();

			const updatePointer = () => {
				const eye = viewer.camera.eye;
				const storeyId = storeyViewsPlugin.getStoreyContainingWorldPos(eye);
				if (!storeyId) {
					hidePointer();
					return;
				}
				const inBounds = storeyViewsPlugin.worldPosToStoreyMap(storeyMap, eye, imagePos);
				if (!inBounds) {
					hidePointer();
					return;
				}
				var offset = getPosition(img);
				imagePos[0] += offset.x;
				imagePos[1] += offset.y;

				storeyViewsPlugin.worldDirToStoreyMap(storeyMap, worldDir, imageDir);

				showPointer(imagePos, imageDir);
			};

			viewer.camera.on("viewMatrix", updatePointer);
			viewer.scene.canvas.on("boundary", updatePointer);

			function getPosition(el) {
				var xPos = 0;
				var yPos = 0;
				while (el) {
					if (el.tagName === "BODY") {      // deal with browser quirks with body/window/document and page scroll
						var xScroll = el.scrollLeft || document.documentElement.scrollLeft;
						var yScroll = el.scrollTop || document.documentElement.scrollTop;
						xPos += (el.offsetLeft - xScroll + el.clientLeft);
						yPos += (el.offsetTop - yScroll + el.clientTop);
					} else {
						// for all other non-BODY elements
						xPos += (el.offsetLeft - el.scrollLeft + el.clientLeft);
						yPos += (el.offsetTop - el.scrollTop + el.clientTop);
					}
					el = el.offsetParent;
				}
				return {x: xPos, y: yPos};
			}

			function hidePointer() {
				pointer.style.visibility = "hidden";
			}

			function showPointer(imagePos, imageDir) {

				const angleRad = Math.atan2(imageDir[0], imageDir[1]);
				const angleDeg = Math.floor(180 * angleRad / Math.PI);

				pointer.style.left = (imagePos[0] - 30) + "px";
				pointer.style.top = (imagePos[1] - 30) + "px";
				pointer.style.transform = "rotate(" + -(angleDeg - 45) + "deg)";
				pointer.style.visibility = "visible";
			}
		}
		
	} */
	enableAddingAnnotations() {
		this.createFirstAnnotations();

		window.annotations.on("markerClicked", (annotation) => {
			//annotation.setLabelShown(!annotation.getLabelShown());
			if(document.referrer != ""){
				window.parent.postMessage(["onAnnotationClicked",annotation.id], document.referrer);
				console.log("postmessage()");
			}else{
				console.log("no postmessage()");
			}		
		});
        this.viewer.cameraControl.on("picked", (pickResult) =>{ this.createAnnotation(pickResult._canvasPos)});
	}
	
	
	createFirstAnnotations(){
		console.log("viewer1",document.querySelector("#myViewer"));
		console.log("canvas",document.querySelector("#myCanvas"));
		if(window.annotations){
			window.annotations.destroy();
			window.nbAnno = 1	
		}// =null;
		console.log("=======================enableAnnotations======================")
		var viewer = this.viewer;
		const annotations = new AnnotationsPlugin(viewer, {

			markerHTML: "<div class='annotation-marker' style='background-color: {{markerBGColor}};'>{{glyph}}</div>",
			labelHTML: "<div class='annotation-label' style='background-color: {{labelBGColor}};'>\
				<div class='annotation-title'>{{title}}</div>\
				<div class='annotation-desc'>{{description}}</div>\
				</div>",
			container: document.querySelector("#myViewer"),
			surfaceOffset :0,
	
			values: {
				markerBGColor: "red",
				labelBGColor: "white",
				glyph: "X",
				title: "Untitled",
				description: "No description"
			}
		});
		console.log("annotationsPlugin",annotations)
		const requestParams = this.getRequestParams();
		const isMobile = requestParams.isMobile;
		console.log("isMobile",isMobile)
		this.timerAnnot = null;
		if(!isMobile){




			annotations.on("markerMouseEnter", (annotation) => { 	
				annotation.setLabelShown(true);
			});
			
			annotations.on("markerMouseLeave", (annotation) => {
				annotation.setLabelShown(false);
			});

			annotations.on("markerClicked", (annotation) => {
				this.viewer.cameraFlight.flyTo(annotation);
			});

			

			//this.addEventMouseUpDownForMarker();
			



		}else{
			annotations.on("markerClicked", (annotation) => {

				this.viewer.cameraFlight.flyTo(annotation);

				var params = new Object();
				params.id = annotation.id;
				params.worldPos = annotation.worldPos;
				params.eye = annotation.eye;
				params.look = annotation.look;
				params.up = annotation.up;
				params.nbAnno = annotation.nbAnno;
				setTimeout(() => {
					window.ReactNativeWebView.postMessage(JSON.stringify(params));
				}, 1500);
				
			});
			/* annotations.on("markerMouseEnter", (annotation) => {
				var params = new Object();
				params.id = annotation.id;
				params.worldPos = annotation.worldPos;
				params.eye = annotation.eye;
				params.look = annotation.look;
				params.up = annotation.up;
				params.nbAnno = annotation.nbAnno;
				window.ReactNativeWebView.postMessage(["onAnnotationUpdate",JSON.stringify(params)])
			}); */
		}

		annotations.on("dblclick", (annotation) => {
			console.log("dblclick",annotation);
		
		});
		

		
		window.annotations = annotations;
		console.log("annotations",annotations)
	
		

		//this.addAnnotationOnClickHandler = viewer.scene.input.on("mouseclicked", (coords) => this.createAnnotation(coords));
		
		console.log("=======================enableAnnotations======================")

	} 
	addEventMouseUpDownForMarker(){
		console.log("addEventMouseUpDownForMarker")
		var annotations = window.annotations;
		console.log("annotations",annotations);
		if(annotations && annotations.annotations){
			for(var a in annotations.annotations){
				var annotation = annotations.annotations[a];
				var marker = annotation._marker;
				console.log("marker",marker);
				//viewer.cameraFlight.flyTo(annotation);
				marker.addEventListener("mousedown", function(e) {
					console.log("mousedown")
				this.timerAnnot = setTimeout(function(annotation) {
					alert('Longtouch déclenché');
					this.viewer.cameraFlight.flyTo(annotation);
				}, 2000);
						
				});
				console.log("mousedown passed");

				marker.addEventListener("mouseup", function(e) {
					console.log("mouseup")
					/* if (window.timerAnnot) { */
						clearTimeout(this.timerAnnot);
						this.timerAnnot = null;
						console.log("timeout cleared")
					//}
					
				});
				console.log("mouseup passed");


			}
		}
	}

	openDialogAnnotPostMessage(annotation){
		console.log("openDialogAnnotPostMessage")
		alert("openDialogAnnotPostMessage")
		alert(annotation)


	}
	getRequestParams() {
		const vars = {};
		window.location.href.replace(/[?&]+([^=&]+)=([^&]*)/gi, (m, key, value) => {
			vars[key] = value;
		});
		return vars;
	}

	capteursDemo(niveau){

		const scene = this.viewer.scene;
		//window.objectsMementoColors.restoreObjects(scene);
		var objects = scene.objects;
		var metaObjects = this.viewer.metaScene.metaObjects;
	 	console.log("objects", objects)
		console.log("metaObjects", metaObjects)
		var metaStoreys = this.viewer.metaScene.metaObjectsByType.IfcBuildingStorey;
		console.log("metaStoreys",metaStoreys);

		//var random = Math.floor(Math.random() * Object.keys(metaStoreys).length);
		console.log("random",niveau);
		var cpt = 0;
		for(var s in metaStoreys){
			if(metaStoreys[s].name == niveau){
				var myStorey = metaStoreys[s];
				break;
			}
			cpt++;
		}
		var idsTab = [];
		var ids = "";
		
		if(myStorey && myStorey.children){
			for(var a in myStorey.children){
				idsTab.push(myStorey.children[a].id);
				//ids += myStorey.children[a].id + ",";
			}
			for(var a in objects){
				if(idsTab.includes(objects[a].id)){
					objects[a].xrayed = false;
					//objects[a].colorize = [1.0, 0.0, 0.0];
				}else{
					objects[a].xrayed = true;
				}
			}
			console.log("ids",ids)
			this.bimViewer.viewFitObjects(idsTab);
		}
		


		//on choisi un étage aléatoirement, on récupère les ids de ses objets, on les colories, puis on reset



	}

	createAnnotation(coords){
		console.log("window.nbAnno début create",window.nbAnno)
		console.log("typeof nbAnno",typeof window.nbAnno)
		if(this.isAnnotationsEnabled){
			this.camera = this.viewer.scene.camera;

				const pickResult = this.viewer.scene.pick({
					canvasPos: coords,
					pickSurface: true  // <<------ This causes picking to find the intersection point on the entity
				});

			if (pickResult) {
				console.log("pickResult",pickResult)
				console.log("window.nbAnno milieu create",window.nbAnno)

				var annotation = window.annotations.createAnnotation({
					id: window.nbAnno,
					pickResult: pickResult,// <<------- initializes worldPos and entity from PickResult
					occludable: false,       // Optional, default is true
					markerShown: true,      // Optional, default is true
					labelShown: false,	// Optional, default is true
					eye:this.camera.eye,  
					look:this.camera.look,
					up:this.camera.up,      
					values: {               // HTML template values
						glyph: "A" + window.nbAnno,
						title: "My annotation " + window.nbAnno,
						description: "My description " + window.nbAnno
					},
				});
				


			}
			console.log("annotations",window.annotations) // window.annotations.annotations["myAnnotation"+window.nbAnno]
			console.log("annotation",annotation);
			var params = new Object();
			params.id = annotation.id;
			params.worldPos = annotation.worldPos;
			params.eye = annotation.eye;
			params.look = annotation.look;
			params.up = annotation.up;
			params.nbAnno = window.nbAnno;
			if(pickResult.entity && pickResult.entity.model && pickResult.entity.model.id)
				params.modelId = pickResult.entity.model.id;
			window.nbAnno++;

			//this.addEventMouseUpDownForMarker();
			if(document.referrer != ""){ //disponible qu'à partir de dynedoc
				window.parent.postMessage(["onAnnotationCreation",params], document.referrer);
			}else{
				window.ReactNativeWebView.postMessage(JSON.stringify(params))
			}

			//postMessage(["onAnnotationCreated",annotation.id,pickResult.wordPos,pickResult.entity]);
		}
		
	}
	
	 buildStoreyMapsMenu() {
		console.log("buildStoreyMapsMenu");
		if(!window.storeyMapsCreated){
			
			var viewer = this.viewer;
			var bimViewer = this.bimViewer;
			var storeyViewsPlugin = new StoreyViewsPlugin(viewer, {fitStoreyMaps: true}); //fitStoreyMaps: true
			var metaStoreys = viewer.metaScene.metaObjectsByType.IfcBuildingStorey;
			var storeysMapObj = new Object();
			var myGlobalStoreyId;

			const pointer = document.createElement("div");
			pointer.id = "planPointer";
			pointer.style.width = "60px";
			pointer.style.height = "60px";
			pointer.style.position = "absolute";
			pointer.style["z-index"] = 100000;
			pointer.style.left = "0px";
			pointer.style.top = "0px";
			pointer.style.cursor = "none";
			pointer.style["pointer-events"] = "none";
			pointer.style.transform = "rotate(0deg)";
			pointer.style.visibility = "hidden";
			document.body.appendChild(pointer);


		
			const storeyDiv = document.getElementById("storeys");
			storeyDiv.addEventListener('scroll', function() {
				updatePointer();//hidePointer();
			});
			console.log("storeyDiv",storeyDiv);
			const storeyIds = Object.keys(storeyViewsPlugin.storeys);
			console.log("storeyIds",storeyIds);

			let i = storeyIds.length -1; //-1

			function next() {

				if (i < 0) {
					
					setTimeout(() => {
						let bodyCanvases = document.querySelectorAll('body > canvas');
						bodyCanvases.forEach(canvas => canvas.remove());

					}, 2000);
					return;
				}
				const storeyId = storeyIds[i];
				var myStoreyName;
				for(var a in metaStoreys){
					if(metaStoreys[a].id == storeyId)
					{
						myStoreyName = metaStoreys[a].name;
						
					}
				}
				
				const storeyMap = storeyViewsPlugin.createStoreyMap(storeyId, {
					format: "png",
					width: 300,
					useObjectStates: true,
				});
				console.log("chargement étages");
				storeysMapObj[storeyId] = storeyMap;
				console.log("storeyMap",storeyMap);

				const titleStorey = document.createElement("span");
				titleStorey.innerHTML = "Etage "+myStoreyName;
				titleStorey.id = "titleStorey-"+storeyId;
				titleStorey.style.fontWeight = "bold";
				titleStorey.style.fontSize = "20px";
				storeyDiv.appendChild(titleStorey);
				const img = document.createElement("img");
				img.src = storeyMap.imageData;
				img.id = "storeyMapImg-"+storeyId;
				img.style.border = "1px solid #000000";
				img.style.background = "lightblue";
				img.style.width = storeyMap.width + "px";
				img.style.height = storeyMap.height + "px";
				img.style.opacity = 0.8;

				storeyDiv.appendChild(img);

				
				img.onmouseenter = () => {
					img.style.cursor = "pointer";
				};

				img.onmouseleave = (e) => {
					img.style.cursor = "default";
				};
				var worldPos = math.vec3();
				img.onclick = (e) => {
					const imagePos = [e.offsetX, e.offsetY];
					var pickResult = null;
					pickResult = storeyViewsPlugin.pickStoreyMap(storeyMap, imagePos, {pickSurface: true});//pickSurface: true nécessaire pour le pickresult 
					if(!pickResult) 
						pickResult = storeyViewsPlugin.pickStoreyMap(storeysMapObj[myGlobalStoreyId], imagePos, {pickSurface: true});
					console.log("pickResult",pickResult);

					if (pickResult) {
						worldPos.set(pickResult.worldPos);
					}else{
						console.log("no pickresult")
						worldPos = storeyViewsPlugin.storeyMapToWorldPos(storeyMap, imagePos); 
					}
					if(pickResult || worldPos){

						const camera = viewer.scene.camera;
						const idx = camera.xUp ? 0 : (camera.yUp ? 1 : 2); 
						var storey = storeyViewsPlugin.storeys[storeyMap.storeyId];
						worldPos[idx] = (storey.storeyAABB[idx] + storey.storeyAABB[3 + idx]) / 2;
						storeyViewsPlugin.showStoreyObjects(storeyMap.storeyId, {
							hideOthers: true
						});
					
						myGlobalStoreyId = storey.storeyId;
						
						viewer.cameraFlight.flyTo({
							eye: worldPos,
							up: viewer.camera.worldUp,
							look: math.addVec3(worldPos, viewer.camera.worldForward, []),
							projection: "perspective",
							duration: 1.5
						}, () => {
							viewer.cameraControl.navMode = "firstPerson";
							window.firstPersonMode.setActive(true);

						});
					}
				};
				viewer.scene.once("tick", next);
				i--;
			}
			console.log("next() =>")
			next();


			function updatePointer () {

				const imagePos = math.vec2();
				const worldDir = math.vec3();
				const imageDir = math.vec2();
				const eye = viewer.camera.eye;
				
				var storeyId = myGlobalStoreyId;
				if(storeyId && storeysMapObj && storeysMapObj[storeyId]){ 
					
					var myStoreyMap = storeysMapObj[storeyId];
					
					const inBounds = storeyViewsPlugin.worldPosToStoreyMap(myStoreyMap, eye, imagePos);
					if (!inBounds) {
						hidePointer();
						return;
					}
					var myStoreyNameP;
					var img;
					for(var a in storeyViewsPlugin.storeys){
						if(storeyViewsPlugin.storeys[a].storeyId == storeyId)
						{
							console.log('idStorey (a) ',a);
							img = document.querySelector("#storeyMapImg-"+a);
						}
					}
					for(var a in metaStoreys){
						if(metaStoreys[a].id == storeyId)
						{
							myStoreyNameP = metaStoreys[a].name;
						}
					}
				
					var offset = getPosition(img);
					imagePos[0] += offset.x;
					imagePos[1] += offset.y;
			
					storeyViewsPlugin.worldDirToStoreyMap(myStoreyMap, worldDir, imageDir);
			
					showPointer(imagePos, imageDir);
				}else{
					//console.log("infos needed");
				} 
			
		}
			viewer.camera.on("viewMatrix", updatePointer);
			viewer.scene.canvas.on("boundary", updatePointer);

			
			
		function getPosition(el) {
				var xPos = 0;
				var yPos = 0;
				while (el) {
					if (el.tagName === "BODY") {      // deal with browser quirks with body/window/document and page scroll
						var xScroll = el.scrollLeft || document.documentElement.scrollLeft;
						var yScroll = el.scrollTop || document.documentElement.scrollTop;
						xPos += (el.offsetLeft - xScroll + el.clientLeft);
						yPos += (el.offsetTop - yScroll + el.clientTop);
					} else {
						// for all other non-BODY elements
						xPos += (el.offsetLeft - el.scrollLeft + el.clientLeft);
						yPos += (el.offsetTop - el.scrollTop + el.clientTop);
					}
					el = el.offsetParent;
				}
				return {x: xPos, y: yPos};
			}
		
			function hidePointer() {
				var pointer = document.querySelector("#planPointer");
				//console.log("hidePointer pointer",pointer);
				pointer.style.visibility = "hidden";
			}
		
			function showPointer(imagePos, imageDir) {
				var pointer = document.querySelector("#planPointer");
				//console.log("showPointer pointer",pointer);
				const angleRad = Math.atan2(imageDir[0], imageDir[1]);
				const angleDeg = Math.floor(180 * angleRad / Math.PI);
		
				pointer.style.left = (imagePos[0] - 30) + "px";
				pointer.style.top = (imagePos[1] - 30) + "px";
				pointer.style.transform = "rotate(" + -(angleDeg - 45) + "deg)";
				pointer.style.visibility = "visible";
			}

			window.storeyMapsCreated = true;
	}else{
	console.log("Les plans d'étages ont déjà été créés");
	 var storeyDiv = document.getElementById("storeys");
	 var pointer = document.getElementById("planPointer");
	 if(!window.displayStoreyMaps){ //===
	 	storeyDiv.style.display = "none";
		pointer.style.display = "none";
		 window.displayStoreyMaps = true;
	 }else{
		storeyDiv.style.display = "block";
		pointer.style.display = "block";
		window.displayStoreyMaps = false;
	 }
	}
}

	initConfViewer(isReset){
		const scene = this.viewer.scene;
		/* var objects = scene.objects;
		var metaObjects = this.viewer.metaScene.metaObjects;
	 	console.log("objects", objects)
		console.log("metaObjects", metaObjects)
		
		var color = 0;
		var all = 0;
		for (var i in objects)
		{
			var oo = objects[i];
			if (oo.meshes && oo.meshes[0] && oo.meshes[0]._color)
			{
			var o = oo.meshes[0]._color;
			var oc = oo.meshes[0]._colorize;
			for(var b in oo.meshes){
				oo.meshes[b].isObject = true;
			}
			
			if ((oo.meshes.length == 1 && o[0] == 255 && o[1] == 255 && o[2] == 255))
			{
				
				all++;
				if (oo._colorizing)
				color++;
				if (ViewerIFCObjectColors[metaObjects[oo.id].type])
					oo.colorize = ViewerIFCObjectColors[metaObjects[oo.id].type].colorize;
				else
					oo.colorize = [0.6, 0.6,0.6]; 
			}
			
			}
			
			
		}
		window.objectsMementoColors = new ObjectsMemento();
		window.objectsMementoColors.saveObjects(scene);  */
	
		if (document.referrer != "")
		{
			window.removeEventListener("message",this.setQuery.bind(this)); 
			window.addEventListener("message", this.setQuery.bind(this),false); //essentiel pour chaque fonction BIM

			//window.addEventListener("dblclick",this.handleDblClick.bind(this),false);

			console.log("***********DOCUMENT**************",document.referrer);
			console.log("this.viewer.scene",this.viewer.scene);
			console.log("scene",scene);
			var metaModels = this.viewer.scene._modelIds ? this.viewer.scene._modelIds : this.viewer.scene.modelIds   ; 
			console.log("metaModels",metaModels);
			//this.bimViewer.setSpacesShown(true);//test 20/03
			this.viewer.camera.far = 500000.0; 
			window.parent.postMessage(["activateLinkedBim",metaModels], document.referrer); //active le btn de filtre front

			console.log("hasToColorizeCity && this.cityJSONData",window.hasToColorizeCity, window.cityJSONData)
			if(window.hasToColorizeCity && window.cityJSONData){
				const scene = window.viewer.scene;
				var objects = scene.objects;
				for(var a in objects){
					for(var b in window.cityJSONData){
						if(window.cityJSONData[b].batId == objects[a].id){
							console.log("bat trouvé !",objects[a].id);
							objects[a].colorize = [0,0.38,0.65]
						}
					}
				}
				console.log("endCOlorize")
				window.hasToColorizeCity = false;
			}
		}else{
			window.removeEventListener("message",this.setQuery.bind(this)); 
			window.addEventListener("message", this.setQuery.bind(this),false);
		}
		
		if(!isReset){
			this.objectsMemento = new ObjectsMemento();
			this.objectsMemento.saveObjects(scene); 
		}

		
		/* var goToViewX = prompt('Renseignez la valeur X');
		var goToViewY = prompt('Renseignez la valeur Y');
		this.goToViewBeta(goToViewX,goToViewY); */
		
		/* getIssues(projectId, modelId, done, error) {
			const url = this._dataDir + "/projects/" + projectId + "/models/" + modelId + "/issues.json";
			utils.loadJSON(url, done, error);
		} */
		//this.server.getIssues("ilotpasteur","821b834a-7d95-410e-9b6d-d9e32b55f0a0;821b834a:36a45edc2a7b9a2;null,30f0de84-993e-4fb9-a326-82abad6e1446;30f0de84:36a45edc2a7b9a2;null",this.getIssuesDoneCallback(),this.getIssuesErrorCallback());
		//this.server.getIssues("dev","5d81103a-5db1-4ee8-a6fb-12f64b78f86b",this.getIssuesDoneCallback(),this.getIssuesErrorCallback());

		
	}
	handleDblClick(){
		this.isDblClick = true;
		if(window.lastEntity){
			console.log("lastEntity",window.lastEntity);
			var myEntity = JSON.parse(JSON.stringify(window.lastEntity))
			this.bimViewer.viewFitObjects([myEntity.id]);

			setTimeout(() => {
				window.parent.postMessage(["onDblClickObjectBim",this.decode(JSON.stringify(myEntity))], document.referrer); 
			}, 500);
		}
	}
	getIssuesDoneCallback(){
		console.log("getIssuesDoneCallback")
	
	}
	getIssuesErrorCallback(){
		console.log("getIssuesErrorCallback")
	}
	hideByPressingSuppr(e){
		console.log("e",e)
		console.log(this.selectedObjectIds)
	}
	// Define a function to convert hex to string
   hexToString = (hex) => {
	let str = '';
	for (let i = 0; i < hex.length; i += 2) {
	  const hexValue = hex.substr(i, 2);
	  const decimalValue = parseInt(hexValue, 16);
	  str += String.fromCharCode(decimalValue);
	}
	return decodeURIComponent(escape(str));
  }
  convertColorFormat(h){
     
    let r = 0, g = 0, b = 0;
  
    // 3 digits
    if (h.length == 4) {
      r = "0x" + h[1] + h[1];
      g = "0x" + h[2] + h[2];
      b = "0x" + h[3] + h[3];
  
    // 6 digits
    } else if (h.length == 7) {
      r = "0x" + h[1] + h[2];
      g = "0x" + h[3] + h[4];
      b = "0x" + h[5] + h[6];
    }
    
    return r/255 + "," + +g/255 + "," + +b/255 ;
  
     }

	showToast(message, duration = 3000) {
		const container = document.querySelector("#toastContainer");
		// Crée l’élément toast
		const toast = document.createElement('div');
		toast.className = 'toast';
		toast.textContent = message;

		// Ajoute au DOM
		if(container){
		container.appendChild(toast);
		console.log('[Toast] appendChild');

		}else
		console.log("no container ??")
		// Force un reflow pour déclencher la transition
		// (nécessaire pour que .show soit pris en compte)
		void toast.offsetWidth;
		toast.classList.add('show');
		console.log('[Toast] show');

		console.log("container",container);

		// Au bout de `duration`, on retire la classe .show pour l’animation de sortie
		setTimeout(() => {
			toast.classList.remove('show');
			console.log('[Toast] remove show');

			// Après la transition, on retire complètement l’élément
			toast.addEventListener('transitionend', () => {
				console.log('[Toast] remove show 2');

			toast.remove();
			});
		}, duration);
 	}
   verifyRequirement(ifcClass,nameProp,verifType,valueToVerif,visibleObjects,isGlobal){
	var result = new Object();
	result.valids = [];
	result.invalids = [];
	var objects = this.viewer.metaScene.metaObjects;
	console.log("objects",objects);
	for(var k in visibleObjects){ //parcours chaque objet visible
		if (isGlobal){
			var object = visibleObjects[k];
		}else{
			var object = objects[visibleObjects[k]];
		}
		if(object.type && ifcClass == object.type){
			var valid = false;
			var propertySets = object.propertySets; //section

			switch (verifType) {
				case "Existence":
					for (var i in propertySets){
						var propertySet = propertySets[i];
						if(propertySet != undefined){
							var propsSet = propertySet.properties;
							for(var p in propsSet){
								if(propsSet[p].name == nameProp){
									valid = true;
								}
							}
						}
					}
					
				break;
				case "Value":
					for (var i in propertySets){
						var propertySet = propertySets[i];
						if(propertySet != undefined){
							var propsSet = propertySet.properties;
							for(var p in propsSet){
								if (propsSet[p].name == nameProp){
									var value = propsSet[p].value ;
									if (value == valueToVerif){
										valid = true;
									}
								}
							}
							
						}
					}
				break;
				case "DataType" : 
				//ajouter pleins de valeurs possible pour le typeof (number, integer, string, boolean, object, array, null, undefined) non sensible à la casse pour couvrir tous les cas
					for (var i in propertySets){
						var propertySet = propertySets[i];
						if(propertySet != undefined){
							var propsSet = propertySet.properties;
							for(var p in propsSet){
								if (propsSet[p].name == nameProp){
									var value = propsSet[p].value;
									if (this.isType(value,valueToVerif)){
										valid = true;
									}
								}
							}
							
						}
					}
				break;
				case "Range" : 
					var min = Number(valueToVerif["MinValue"]);
					var max = Number(valueToVerif["MaxValue"]);
					//ajouter pleins de valeurs possible pour le typeof (number, integer) non sensible à la casse pour couvrir tous les cas
					for (var i in propertySets){
						var propertySet = propertySets[i];
						if(propertySet != undefined){
							var propsSet = propertySet.properties;
							for(var p in propsSet){
								if (propsSet[p].name == nameProp){
									var value = propsSet[p].value;
									if(this.isType(value,"number")){
										console.log("typeof value (Number ???)",typeof value, "( " ,value , " ) => min ",min," max ",max, );
										if (Number(value) >= min && Number(value) <= max ){ 
											valid = true;
										}
									}
								}
							}
							
						}
					}
				break;
				case "Pattern" : 
					for (var i in propertySets){
						var propertySet = propertySets[i];
						if(propertySet != undefined){
							var propsSet = propertySet.properties;
							for(var p in propsSet){
								if (propsSet[p].name == nameProp){
									var value = propsSet[p].value;
									const regex = new RegExp(valueToVerif); // Crée une expression régulière à partir du pattern
									if (regex.test(value)){ 
										valid = true;
									}
								}
							}
							
						}
					}
				break;
				case "Unit" : 
					for (var i in propertySets){
						var propertySet = propertySets[i];
						if(propertySet != undefined){
							var propsSet = propertySet.properties;
							for(var p in propsSet){
								if (propsSet[p].name == nameProp){
									var value = propsSet[p].value;
									var trimmedValue = value.trim().toLowerCase();
									var unitLower = valueToVerif.toLowerCase();
									if (trimmedValue.endsWith(unitLower)){ 
										valid = true;
									}
								}
							}
							
						}
					}
				break;


				default:
				break;
			}

			if(valid == true)
				result.valids.push(object.id);
			else
				result.invalids.push(object.id);
			
		}
	}

	console.log(ifcClass," respecte ", verifType ," = ", valueToVerif,"  ====>  ",result);
	return result;
   }

isType(variable, type) {
	const types = {
	  number: ["number", "nombre", "integer", "int", "float", "double"],
	  string: ["string", "texte", "text", "char", "varchar"],
	  boolean: ["boolean", "bool", "true/false", "vrai/faux"],
	  array: ["array", "table", "tableau", "liste", "list"],
	  object: ["object", "objet", "json", "dict", "dictionnaire", "map"],
	  function: ["function", "func", "fonction", "callable"],
	  undefined: ["undefined", "indéfini"],
	  null: ["null", "nul", "vide"]
	};
	
	// Normalise le type demandé en minuscule pour la recherche
	type = type.toLowerCase();
	
	// Recherche le type dans la table des types connus
	for (const [key, aliases] of Object.entries(types)) {
	  if (aliases.includes(type)) {
		if (key === "array") {
		  return Array.isArray(variable);  // Gestion spécifique pour les tableaux
		} else if (key === "null") {
		  return variable === null;  // Gestion spécifique pour null
		}
		return typeof variable === key;
	  }
	}
	
	return false; // Si aucun type correspondant n'est trouvé
}

verifierObjetIFC(IfcObject, idsXmlDocument) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(idsXmlDocument, "application/xml");
    var testPassed = [];
    var testFailed = [];
    var isAttributeValueValid = true;
    var isAttributeValuesAllowed = true;
    var isPropertyExist = true;
    var isPropertyValid = true;
    var isMaterialValid = true;

    // Récupérer les spécifications du fichier IDS XML
    const specifications = xmlDoc.getElementsByTagName("specification");

    // Fonction pour vérifier si une valeur est dans un intervalle
    function isValueInRange(value, min, max) {
        return value >= min && value <= max;
    }

    // Fonction pour vérifier le type de données (ex : 'number', 'integer', etc.)
    function isValidDataType(value, expectedType) {
        const typeMap = {
            'number': (val) => !isNaN(val), // Covers number, float
            'integer': (val) => Number.isInteger(parseFloat(val)),
            'string': (val) => typeof val === 'string',
            // Ajoute d'autres types si nécessaire
        };

        const validator = typeMap[expectedType.toLowerCase()];
        return validator ? validator(value) : false;
    }

    // Parcourir toutes les spécifications présentes dans l'IDS
    for (let i = 0; i < specifications.length; i++) {
        const spec = specifications[i];

        // Vérifier l'entité (classe IFC à laquelle la spécification s'applique)
        const entityNode = spec.getElementsByTagName("entity")[0];
        if (!entityNode) continue;  // Sauter si aucune entité n'est définie

        const entityName = entityNode.getElementsByTagName("simpleValue")[0]?.textContent || "";

        // Comparer le type d'entité de l'objet IFC avec celui défini dans la spécification IDS
        if (IfcObject.type !== entityName) {
            if (testPassed.indexOf("ignored entity") == -1)
                testPassed.push("ignored entity");
            continue;  // Passer à la spécification suivante si ce n'est pas le bon type d'entité
        }

        // Vérifier les attributs définis dans la spécification
        const attributes = spec.getElementsByTagName("attribute");
        for (let j = 0; j < attributes.length; j++) {
            const attribute = attributes[j];
            const attributeName = attribute.getElementsByTagName("simpleValue")[0]?.textContent || "";
            const expectedValueNode = attribute.getElementsByTagName("value")[0];

            // Récupérer l'attribut de l'objet IFC dans xeokit
            const actualValue = IfcObject.attributes[attributeName] || "no attribute"; //IfcObject.getProperty(attributeName)

            // Gérer les restrictions de type et plage de valeurs
            if (expectedValueNode) {
                const expectedValue = expectedValueNode.getElementsByTagName("simpleValue")[0]?.textContent || "";
                const expectedTypeNode = expectedValueNode.getAttribute("type"); // Type attendu
                const minValue = parseFloat(expectedValueNode.getAttribute("min"));
                const maxValue = parseFloat(expectedValueNode.getAttribute("max"));

                // Vérification du type de données
                if (expectedTypeNode && !isValidDataType(actualValue, expectedTypeNode)) {
                    console.log(`Erreur: L'objet IFC n'a pas le bon type de données pour l'attribut ${attributeName}. Type attendu : ${expectedTypeNode}`);
                    testFailed.push(`Invalid type for attribute: ${attributeName}`);
                    isAttributeValueValid = false;
                    continue;
                }

                // Vérification des plages de valeurs
                if (!isNaN(minValue) && !isNaN(maxValue) && !isValueInRange(actualValue, minValue, maxValue)) {
                    console.log(`Erreur: La valeur de ${attributeName} n'est pas dans la plage autorisée (${minValue} - ${maxValue}).`);
                    testFailed.push(`Out of range value for attribute: ${attributeName}`);
                    isAttributeValueValid = false;
                    continue;
                }

                // Vérification de la valeur simple
                if (actualValue !== expectedValue) {
                    console.log(`Erreur: L'objet IFC n'a pas la bonne valeur pour l'attribut ${attributeName}. Valeur attendue : ${expectedValue}`);
                    testFailed.push(`Invalid attribute value: ${attributeName}`);
                    isAttributeValuesAllowed = false;
                } else {
                    testPassed.push("valid attributes value");
                }
            }
        }

        // Vérifier les propriétés définies dans la spécification
        const properties = spec.getElementsByTagName("property");
        for (let k = 0; k < properties.length; k++) {
            const property = properties[k];
            const propertySetName = property.getElementsByTagName("propertySet")[0]?.textContent || "";
            const propertyName = property.getElementsByTagName("name")[0]?.textContent || "";

            // Récupérer les propriétés depuis xeokit
            let actualPropertySet;
            for (var p in IfcObject.propertySets) {
                if (IfcObject.propertySets[p]) {
                    for (var prop in IfcObject.propertySets[p].properties) {
                        if (IfcObject.propertySets[p].properties[prop].name == propertyName) {
                            actualPropertySet = IfcObject.propertySets[prop].name;
                        }
                    }
                }
            }

            if (!actualPropertySet) {
                console.log(`Erreur: L'objet IFC ne contient pas la propriété ${propertySetName}.${propertyName}`);
                testFailed.push(`Missing property: ${propertySetName}.${propertyName}`);
                isPropertyExist = false;
            } else {
                testPassed.push("property exist");
            }

            // Si une valeur est attendue
            const expectedPropertyValueNode = property.getElementsByTagName("value")[0];
            if (expectedPropertyValueNode) {
                const expectedPropertyValue = expectedPropertyValueNode.getElementsByTagName("simpleValue")[0]?.textContent || "";
                const expectedTypeNode = expectedPropertyValueNode.getAttribute("type"); // Type attendu
                const minValue = parseFloat(expectedPropertyValueNode.getAttribute("min"));
                const maxValue = parseFloat(expectedPropertyValueNode.getAttribute("max"));

                // Vérification du type de données pour la propriété
                if (expectedTypeNode && !isValidDataType(actualPropertySet, expectedTypeNode)) {
                    console.log(`Erreur: La propriété ${propertySetName}.${propertyName} n'a pas le bon type de données. Type attendu : ${expectedTypeNode}`);
                    testFailed.push(`Invalid type for property: ${propertySetName}.${propertyName}`);
                    isPropertyValid = false;
                    continue;
                }

                // Vérification des plages de valeurs
                if (!isNaN(minValue) && !isNaN(maxValue) && !isValueInRange(actualPropertySet, minValue, maxValue)) {
                    console.log(`Erreur: La propriété ${propertySetName}.${propertyName} n'est pas dans la plage autorisée (${minValue} - ${maxValue}).`);
                    testFailed.push(`Out of range value for property: ${propertySetName}.${propertyName}`);
                    isPropertyValid = false;
                    continue;
                }

                if (actualPropertySet !== expectedPropertyValue) {
                    console.log(`Erreur: La propriété ${propertySetName}.${propertyName} n'a pas la bonne valeur. Valeur attendue : ${expectedPropertyValue}`);
                    testFailed.push(`Invalid property value: ${propertySetName}.${propertyName}`);
                    isPropertyValid = false;
                } else {
                    testPassed.push("property value valid");
                }
            }
        }
    }

    if (isAttributeValueValid && isAttributeValuesAllowed && isPropertyExist && isPropertyValid && isMaterialValid) {
        console.log("L'objet IFC est conforme aux spécifications IDS.", testPassed);
        return [true, testPassed];
    } else {
        console.log("L'objet IFC n'est pas conforme aux spécifications IDS.", testFailed);
        return [false, testFailed];
    }
}

/*  console.log("=================== Spec n° ", cpt, "=====================");
        console.log("details", specification); */
		checkIfcObjects(ifcObjects, idsSpecifications) {
			let results = [];
			let cpt = 0;
		
			// Boucle sur chaque spécification dans IDS
			idsSpecifications.specifications.specification.forEach(specification => {
				const applicableEntity = specification.applicability.entity?.name?.simpleValue;
				const applicableProperty = specification.applicability.property;
		
				console.log("=================== Spec n° ", cpt, "=====================");
				console.log("details", specification);
				cpt++;
		
				// Préparation de l'analyse de la spécification
				let specResult = {
					specification: specification,
					invalidObjects: [],
					validObjects: [],
					ignoredObjects: []
				};
		
				// Parcours des objets IFC dans ifcObjects
				for (let objectKey in ifcObjects) {
					if (ifcObjects.hasOwnProperty(objectKey)) {
						let ifcObject = ifcObjects[objectKey];
						let isValid = true;  // On commence par supposer que l'objet est valide
						let missingElements = [];  // Pour capturer les éléments manquants ou incorrects
		
						// Vérification des conditions d'applicabilité
						let matchesApplicability = true;
		
						// Vérifie si l'entité est applicable
						if (applicableEntity && ifcObject.type !== applicableEntity) {
							matchesApplicability = false;
						}
		
						// Vérification des propriétés dans les exigences d'applicabilité
						if (applicableProperty && applicableProperty.propertySet && applicableProperty.name) {
							let propertySetName = applicableProperty.propertySet.simpleValue;
							let propertyName = applicableProperty.name.simpleValue;
							let propertyFound = false;
		
							for (let p in ifcObject.propertySets) {
								if (ifcObject.propertySets[p] && ifcObject.propertySets[p].name === propertySetName) {
									for (let prop of ifcObject.propertySets[p].properties) {
										if (prop.name === propertyName) {
											propertyFound = true;
											break;
										}
									}
								}
							}
		
							if (!propertyFound) {
								matchesApplicability = false;
							}
						}
		
						// Si l'objet ne correspond pas aux critères d'applicabilité, on l'ajoute à ignoredObjects
						if (!matchesApplicability) {
							specResult.ignoredObjects.push({
								ifcObjectId: ifcObject.id,
								ifcObjectName: ifcObject.name,
								reason: "Ne correspond pas aux critères d'applicabilité"
							});
							continue; // Passe à l'objet suivant
						}
		
						// 1. Vérification des attributs
						if (specification.requirements.attribute) {
							let attributes = Array.isArray(specification.requirements.attribute)
								? specification.requirements.attribute
								: [specification.requirements.attribute];  // Gérer plusieurs attributs
		
							for (let attributeReq of attributes) {
								let attributeName = attributeReq.name?.simpleValue;
								let ifcAttributeValue = ifcObject[attributeName]; // Accès direct aux attributs IFC
		
								// Vérification des valeurs spécifiques si elles sont présentes (enumerationAttribute ou attributeValue)
								if (attributeReq.value) {
									if (attributeReq.value['xs:restriction'] && attributeReq.value['xs:restriction']['xs:enumeration']) {
										// Cas de enumerationAttribute
										let enumerationValues = attributeReq.value['xs:restriction']['xs:enumeration'];
										let found = enumerationValues.some(enumVal => enumVal.value === ifcAttributeValue);
										if (!found) {
											isValid = false;
											missingElements.push(`Valeur non autorisée pour l'attribut : ${attributeName}`);
											//console.log(`Valeur non autorisée : ${ifcAttributeValue} pour l'attribut ${attributeName}`);
										}
									} else if (attributeReq.value.simpleValue) {
										// Cas de attributeValue
										if (attributeReq.value.simpleValue !== ifcAttributeValue) {
											isValid = false;
											missingElements.push(`Valeur incorrecte pour l'attribut : ${attributeName}`);
											//console.log(`Valeur incorrecte : ${ifcAttributeValue} pour l'attribut ${attributeName}`);
										}
									}
								} else {
									// Vérification de l'existence de l'attribut (attributeExist)
									if (!ifcObject.hasOwnProperty(attributeName)) {
										isValid = false;
										missingElements.push(`Attribut manquant : ${attributeName}`);
										//console.log(`Attribut manquant : ${attributeName} dans l'objet ${ifcObject.name}`);
									} else {
										//console.log(`Attribut trouvé : ${attributeName} avec la valeur : ${ifcAttributeValue}`);
									}
								}
		
								if (!isValid) break; // Si un attribut échoue, on arrête la vérification des autres
							}
						}
		
						// 2. Vérification des propriétés
						if (specification.requirements.property && isValid) { // Ne vérifie que si les attributs sont valides
							let properties = Array.isArray(specification.requirements.property)
								? specification.requirements.property
								: [specification.requirements.property];  // Gérer plusieurs propriétés
		
							for (let propertyReq of properties) {
								let foundProperty = false;  // Pour vérifier si la propriété a été trouvée
								let propertySetName = propertyReq.propertySet?.simpleValue;  // Ajouter une vérification
								let propertyName = propertyReq.name?.simpleValue;  // Ajouter une vérification
		
								if (propertySetName && propertyName) { // Vérifie que les noms existent avant de continuer
									for (let p in ifcObject.propertySets) {
										if (ifcObject.propertySets[p] && ifcObject.propertySets[p].name === propertySetName) {
											for (let prop of ifcObject.propertySets[p].properties) {
												if (prop.name === propertyName) {
													foundProperty = true;  // Propriété trouvée
												//	console.log(`Propriété trouvée : ${propertyName} dans ${propertySetName}`);
													break;
												}
											}
										}
									}
		
									// Si la propriété requise n'a pas été trouvée
									if (!foundProperty) {
										isValid = false;
										missingElements.push(`Propriété manquante : ${propertySetName} => ${propertyName}`);
										//console.log(`Propriété manquante : ${propertySetName} => ${propertyName}`);
									}
								}
								
								if (!isValid) break; // Si une propriété échoue, on arrête la vérification
							}
						}
		
						// Si l'objet est invalide, on l'ajoute aux résultats de la spécification
						if (!isValid) {
							specResult.invalidObjects.push({
								ifcObjectId: ifcObject.id,
								ifcObjectName: ifcObject.name,
								invalidProperties: ifcObject.propertySets,
								missingElements: missingElements // Ajout des détails sur les éléments manquants
							});
						} else {
							// Si l'objet est valide, on l'ajoute aux objets valides
							specResult.validObjects.push({
								ifcObjectId: ifcObject.id,
								ifcObjectName: ifcObject.name,
								validProperties: ifcObject.propertySets
							});
						}
					}
				}
		
				// Ajoute les résultats de la spécification si des objets invalides, valides ou ignorés sont trouvés
				if (specResult.invalidObjects.length > 0 || specResult.validObjects.length > 0 || specResult.ignoredObjects.length > 0) {
					results.push(specResult);
				}
			});
		
			return results;
		}

		isANumber(value){
			return !isNaN(parseFloat(value));
		}
		
		




  
  
	

	setQuery(e){ //si le target c'est lui meme, ne pas écouter
		console.log("================setQuery==================")
		console.log("e.data[0]",e.data[0]);
		console.log("e.data[1]",e.data[1]);

		console.log("e.data[2]",e.data[2]);		
		
		var result = new Object();
					result.bat = new Object();
					result.niveau = new Object();
					result.space = new Object();
					result.object = new Object();
					result.code = new Object();
		const scene = this.viewer.scene;

		if (e.data[2] != true && e.data[2] != "true"){
			this.bimViewer.resetView(); //attention !!

			if (e.data[1] && e.data[1].filterMethodIsXray)
				scene.setObjectsXRayed(this.viewer.scene.objectIds, true);
			else
				scene.setObjectsVisible(this.viewer.scene.objectIds, false);
			
		}
		var showSpace = this.bimViewer._showSpacesMode._active;
		console.log("showSpace early",showSpace);
		switch (e.data[0]){
			case "BatCheckboxFilter":
				console.log("BIMData",e.data);
				console.log("event(BatCheckboxFilter)",e);
				console.time("batcheckboxFilter")
				var objTabIds = e.data[1].ids;
				var tempIds = [];
				var surfaceResult = 0;
				var volumeResult = 0;
				var nbElemResult = 0;
				if(e.data[1].DONOTcontainsClassIfc || e.data[1].containsClassIfc)
					var IfcClassQuery = true;

				objects = this.viewer.metaScene.metaObjects;
				console.log("OBJECT from CONTROLLER",objects);
				if (e.data[1].sections)
				{
					var sectionsData = e.data[1].sections
					var sectionCount = Object.keys(sectionsData).length;
					console.log("sectionCount",sectionCount);
					if (objTabIds == "ALL")
					objTabIds = objects
					for (var o in objTabIds)
					{
						var color;
						var colorClassIFC;

						if (objTabIds == objects)
							var k = o;
						else
							var k = objTabIds[o];
						var object = objects[k];
						var propertySets = object.propertySets;
						var existCount = 0;
						var exist = false;
					
						var objVolume = 0;
						var objSurface = 0;

						if(IfcClassQuery){
							if (e.data[1].containsClassIfc){
								if (object.type != e.data[1].containsClassIfc)
									continue;
								else{
									colorClassIFC = e.data[1].colorClassIfc;
									}
								
							}
							if (e.data[1].DONOTcontainsClassIfc){
								if (object.type == e.data[1].DONOTcontainsClassIfc)
									continue;
								else{
									colorClassIFC = e.data[1].colorClassIfc;
								}
										
									
							}
						}

						
						for (var i in propertySets) //boucle sur les section de chaque objets BIM
						{	
							if(propertySets[i]){
								var propertySet = propertySets[i]; 
								var propsSet = propertySet.properties;
								var mySections = sectionsData;
								for(var s in mySections){
									/* console.log("==================================")
									console.log("mySections[s] VS",this.decode( mySections[s].section,true));
									console.log("propertySet[i]",propertySet.name); */
									if (propertySet.name == this.decode( mySections[s].section,false) || propertySet.name == this.decode( mySections[s].section,true))	
									{

										/* console.log("propsSet",propsSet) */
										for(var p in propsSet){ //boucle sur les properties BIM
												if ( propsSet[p].name == this.decode( mySections[s].property,false) || propsSet[p].name == this.decode( mySections[s].property,true))
												{
													
													var value = propsSet[p].value ;
													var secValue = this.decode( mySections[s].value,false);

													if (mySections[s].typeValue == "Texte")
													{

														value = value.toString().toLowerCase();
														secValue = secValue.toLowerCase();
														if ((value == secValue && mySections[s].compare == "strictement égal à" ) || (value.indexOf(secValue) != -1 && mySections[s].compare == "Contient" )){
															existCount++;
															exist = true;
															
															if( mySections[s].color)
																color = mySections[s].color;

														}
													}
													if (mySections[s].typeValue == "Number")
													{
														value = Number(value);
														secValue =  Number(secValue);
														if ((value ==  secValue && mySections[s].compare == "=" ) || ( value < secValue && mySections[s].compare == "<" ) || ( value > secValue && mySections[s].compare == ">" )){
															existCount++;
															exist = true;
															if(mySections[s].color)
																color = mySections[s].color;

														}
													}
													
													
												}

												
					
										}
										
									}
								}
								for(var p in propsSet){
									if(propsSet[p].name == "Surface"){ // a faire plus tard en dynamique avec oBim
										objSurface = propsSet[p].value;

									}

									if(propsSet[p].name == "Volume"){ // a faire plus tard en dynamique avec oBim
										objVolume = propsSet[p].value;

									}
								}
							}
						}
						if ((existCount == sectionCount) || (exist && e.data[1].filterModeIsOr == true )){
							//console.log("tempIds.push(objid)");
							tempIds.push(k);
							nbElemResult++;
							surfaceResult += Number(objSurface);
							volumeResult += Number(objVolume);
						}

						var oo = scene.objects[object.id];
						if(exist){
							if(oo && color && color !="default")
								oo.colorize = color.split(",");
						}
						if(oo &&  colorClassIFC && colorClassIFC !="default")
							oo.colorize = colorClassIFC.split(",");
							
						
					
					}
					objTabIds = tempIds;

				}else if(e.data[2] == "IdOrNameFilter"){
					for(var id in objTabIds){
						for(var ob in objects){
							if(objects[ob].id == objTabIds[id]){
								nbElemResult++;
								var propSet = objects[ob].propertySets;
								for(var ps in propSet){
									if(propSet[ps] && propSet[ps].name == "Cotes"){
										var prop = propSet[ps].properties;
										for(var p in prop){
											if(prop[p].name == "Surface"){
												
												surfaceResult += Number(prop[p].value);											
											}
											if(prop[p].name == "Volume"){
												
												volumeResult += Number(prop[p].value);
											}
										}
									}
								}
							}
						}
					}
				}else{
					if(objTabIds)
						nbElemResult = objTabIds.length;
				}
		

				console.log("___________nbElemResult",nbElemResult)
				console.log("___________surfaceResult",surfaceResult)
				console.log("___________volumeResult",volumeResult)
				console.log("objTabIds result",objTabIds);
				/* console.log("objTabIds result",objTabIds);
				console.log("existCount",existCount);
				console.log("event.data",e.data)
				console.log("scene.objects",scene.objects) */
				//console.log("colors",colors);
		
				if (e.data[1].filterMethodIsXray){
					scene.setObjectsVisible(objTabIds, true);
					scene.setObjectsXRayed(objTabIds, false); //premier test 
				}else{
					scene.setObjectsVisible(objTabIds, true);
				}
				this.bimViewer.viewFitObjects(objTabIds);

				console.log("visible objects",scene.visibleObjectIds);

				var res = new Object();
				res.count = nbElemResult;
				res.volume = volumeResult;
				res.area = surfaceResult;
				console.log(res);
				if (document.referrer != "")
					window.parent.postMessage(["resultFilterBim",res], document.referrer);
			
				console.timeEnd("batcheckboxFilter")


			break;
			case "filterObjects":	
				console.time("filterObject")

				var groupTabIds = e.data[1];	
				var objects = this.viewer.scene.objects;
				console.log("objects",objects);
				console.time("deselectAll")
				
				this.deselectAll();
				console.timeEnd("deselectAll")
				var ids = "";
				for(var elem in groupTabIds){
					var i = groupTabIds[elem];
					var oo = objects[i];
					if(oo)
						oo.selected = true;
					else{
						if(ids != "")
							ids+=","
						ids += i;
					}
				}
				scene.setObjectsVisible(this.viewer.scene.objectIds, true);
				scene.setObjectsXRayed(this.viewer.scene.objectIds, true);
				scene.setObjectsXRayed(e.data[1], false);

				console.log(scene.selectedObjectIds)
				scene.setObjectsSelected(scene.selectedObjectIds, 1)
				this.bimViewer.viewFitObjects(scene.selectedObjectIds);
				console.timeEnd("filterObject")

				if (document.referrer != "" && ids != ""){
					console.log("objet(s) manquant(s) : ",ids)
					window.parent.postMessage(["resultFilterObjectsMissing",ids], document.referrer);
				}
			break;
			case "filterObjectProperty": 
				console.time("filterObjectProperty")
			
				/* this.bimViewer.resetView();
				scene.setObjectsXRayed(this.viewer.scene.objectIds, true);
				var ids = [];
				var filterObject = e.data[1];
				var section = this.decode(filterObject.section,true);
				var property = this.decode(filterObject.property,true);
				var sectionC = filterObject.sectionC ? this.decode(filterObject.sectionC,true) : "";
				var propertyArea = filterObject.propertyArea ? this.decode(filterObject.propertyArea,true) : "";
				var propertyVolume =  filterObject.propertyVolume ? this.decode(filterObject.propertyVolume,true) : "";
				var value = this.decode(filterObject.propertyValue,true);
				var isBatOrNiv = filterObject.isBatOrNiv ? this.decode(filterObject.isBatOrNiv,true) : ""; 
				var volume = 0;
				var area = 0;
				var objects = [];
				var global = false;
				var bats = this.viewer.metaScene.metaObjectsByType.IfcBuilding;
					console.log("this.viewer.metaScene",this.viewer.metaScene);
					console.log("bats",bats);
				 if (property == "Niveau" || property == "classBim" )
				 {
					 var storeys = this.viewer.metaScene.metaObjectsByType.IfcBuildingStorey;
					 global = true;
					 for (var s in storeys)
					 {
						 if (storeys[s].name == value)
						  objects = storeys[s].children;
					 }
				 }else
				 	objects = this.viewer.metaScene.metaObjects;

				if(isBatOrNiv == "bat"){
					console.log("isbat yes")
					objects = [];
					for(var b in bats){
						if(bats[b].name == value){

							for(var m in bats[b].metaModels){
								for(var c in bats[b].metaModels[m].metaObjects){
									if(objects.indexOf(bats[b].metaModels[m].metaObjects[c]) == -1)
										objects.push(bats[b].metaModels[m].metaObjects[c]);
								}
							}
						}
				}
					}
				

				 for (var k in objects)
				 {
					 var object = objects[k];
					 var propertySets = object.propertySets;
					 var oVolume = 0;
				     var oArea = 0;
					 var addCotes = false;
					 for (var i in propertySets)
					 {			
						if(propertySets[i]){
							var propertySet = propertySets[i];
							if (global)
							{
								if (propertySet.name == sectionC)
								{
									var props = propertySet.properties
									for (var c in props)
									{
										if (props[c].name == propertyArea){	
											oArea = Number(props[c].value);
										}	
										if (props[c].name == propertyVolume){	
											oVolume = Number(props[c].value);
										}
									} 
								}
							
								
							}
							else
							{
								
								if(section && property){	
									if (propertySet.name == sectionC)
									{
										var props = propertySet.properties
										for (var c in props)
										{
											if (props[c].name == propertyArea){	
												oArea = Number(props[c].value);
											}
											if (props[c].name == propertyVolume){	
												oVolume = Number(props[c].value);
											}
										} 
									}

									if (this.decode(propertySet.name,false) == this.decode(section,false))
									{
										
										var props = propertySet.properties
										for (var j in props)
										{
											if (this.decode(props[j].name,false) == this.decode(property,false) && this.decode(props[j].value,false) == this.decode(value,false)) //toUpperCase retiré
											{
												ids.push(object.id);
												addCotes = true;
											}
										}
										
									}
								}else{
									alert("no prop and/or no section");
								}
							}
						}
					 }
					 if(global){ //à la fin pour que les volumes aient le temps de s'incrémenter
						if(ids.indexOf(object.id) == -1){
							ids.push(object.id);
							volume += oVolume;
							area += oArea; 
						}

					 }else{ //à la fin pour que les volumes aient le temps de s'incrémenter
						if(ids.indexOf(object.id) != -1 && addCotes){
							volume += oVolume;
							area += oArea; 
						}
					 }
					 
				 }
				
				 scene.setObjectsVisible(ids, true);
				 scene.setObjectsXRayed(ids, false);

				 
				 this.bimViewer.viewFitObjects(ids);
				 var res = new Object();
				 res.count = ids.length;
				 res.volume = volume;
				 res.area = area;
				 console.log(res); */
				this.bimViewer.resetView();
				
				//scene.setObjectsXRayed(scene.objectIds, true);
				scene.setObjectsVisible(this.viewer.scene.objectIds, true);
				scene.setObjectsXRayed(this.viewer.scene.objectIds, true);
				
				// Cache local de la fonction decode pour éviter des appels via this
				var decode = this.decode.bind(this);

				// Pré-calculs : on décode une seule fois les valeurs critiques
				var filterObject    = e.data[1];
				var decodedSection  = decode(filterObject.section, true);
				var decodedProperty = decode(filterObject.property, true);
				var decodedSectionC = filterObject.sectionC ? decode(filterObject.sectionC, true) : "";
				var decodedPropArea = filterObject.propertyArea ? decode(filterObject.propertyArea, true) : "";
				var decodedPropVol  = filterObject.propertyVolume ? decode(filterObject.propertyVolume, true) : "";
				var decodedValue    = decode(filterObject.propertyValue, true);
				var isBatOrNiv      = filterObject.isBatOrNiv ? decode(filterObject.isBatOrNiv, true) : "";
				
				var totalVolume = 0, totalArea = 0;
				var objects = [];
				var global = false;
				var metaScene = this.viewer.metaScene;
				var bats = metaScene.metaObjectsByType.IfcBuilding;
				
				// Récupération des objets selon le type de propriété
				if (decodedProperty === "Niveau" || decodedProperty === "classBim") {
					var storeys = metaScene.metaObjectsByType.IfcBuildingStorey;
					console.log("storeys",storeys);

					global = true;
					if (!Array.isArray(storeys)) storeys = Object.values(storeys);
					for (var s = 0, sLen = storeys.length; s < sLen; s++) {
					if (storeys[s].name === decodedValue) {
						console.log("concat")
						objects = [...objects, ...storeys[s].children]
						//objects.concat(storeys[s].children);// = storeys[s].children; //merge les children
						console.log("concat",objects)

					}
					}
				} else {
					objects = metaScene.metaObjects;
				}
				
				// Si filtrage par batiment
				if (isBatOrNiv === "bat") {
					console.log("bats",bats);

					var tmpObjs = [];
					if (!Array.isArray(bats)) bats = Object.values(bats);
					for (var b = 0, bLen = bats.length; b < bLen; b++) {
					if (bats[b].name === decodedValue || bats[b].id === decodedValue) {
						var metaModels = bats[b].metaModels;
						for (var m = 0, mLen = metaModels.length; m < mLen; m++) {
						var metaObjs = metaModels[m].metaObjects;
						if (!Array.isArray(metaObjs)) metaObjs = Object.values(metaObjs);
						for (var c = 0, cLen = metaObjs.length; c < cLen; c++) {
							// On ajoute uniquement si l'objet n'est pas déjà présent
							if (tmpObjs.indexOf(metaObjs[c]) < 0) {
								tmpObjs.push(metaObjs[c]);
							}
						}
						}
					}
					}
					objects = tmpObjs;

				}
				if (!Array.isArray(objects)) objects = Object.values(objects);
				
				// Pour éviter de répéter des indexOf sur le tableau des ids, on utilise un objet comme ensemble
				var idsSet = {};
				var ids = [];
				
				// Parcours des objets
				var nObjs = objects.length;
				console.log("nombre d'Objs à analyser = ",nObjs);
				for (var i = 0; i < nObjs; i++) {
					var obj = objects[i];
					var propSets = obj.propertySets;
					if (!propSets) continue;
					if (!Array.isArray(propSets)) propSets = Object.values(propSets);
					
					var objVol = 0, objArea = 0;
					var addCotes = false;
					
					// Pour chaque propertySet, on pré-calcule le nom décodé une seule fois
					var nPS = propSets.length;
					for (var j = 0; j < nPS; j++) {
					var ps = propSets[j];
					if (!ps) continue;
					
					// Mode global : on recherche directement la section correspondant à sectionC
					if (global) {
						if (ps.name === decodedSectionC) {
						var props = ps.properties;
						if (!Array.isArray(props)) props = Object.values(props);
						for (var k = 0, pLen = props.length; k < pLen; k++) {
							var pr = props[k];
							if (pr.name === decodedPropArea) {
							objArea = Number(pr.value);
							}
							if (pr.name === decodedPropVol) {
							objVol = Number(pr.value);
							}
						}
						}
					} else {
						// Mode non global : récupérer area/volume depuis sectionC si présente
						if (ps.name === decodedSectionC) {
						var props = ps.properties;
						if (!Array.isArray(props)) props = Object.values(props);
						for (var k = 0, pLen = props.length; k < pLen; k++) {
							var pr = props[k];
							if (pr.name === decodedPropArea) {
							objArea = Number(pr.value);
							}
							if (pr.name === decodedPropVol) {
							objVol = Number(pr.value);
							}
						}
						}
						// Comparaison sur la section ciblée
						var psNameDec = decode(ps.name, false);
						// On évite de décoder plusieurs fois les mêmes valeurs en redécodant uniquement une fois
						if (psNameDec === decode(decodedSection, false)) {
						var props = ps.properties;
						if (!Array.isArray(props)) props = Object.values(props);
						for (var k = 0, pLen = props.length; k < pLen; k++) {
							var pr = props[k];
							// Comparaison sur le nom et la valeur de la propriété
							if (decode(pr.name, false) === decode(decodedProperty, false) &&
								decode(pr.value, false) === decode(decodedValue, false)) {
							if (!idsSet[obj.id]) {
								idsSet[obj.id] = true;
								ids.push(obj.id);
							}
							addCotes = true;
							}
						}
						}
					}
					} // Fin boucle propertySets
					
					// Mise à jour des totaux en fonction du mode
					if (global) {
					if (!idsSet[obj.id]) {
						idsSet[obj.id] = true;
						ids.push(obj.id);
						totalVolume += objVol;
						totalArea += objArea;
					}
					} else {
					if (idsSet[obj.id] && addCotes) {
						totalVolume += objVol;
						totalArea += objArea;
					}
					}
				}
				
				// Mise à jour de la scène et ajustement de la vue
				scene.setObjectsVisible(ids, true);
				scene.setObjectsXRayed(ids, false);
				this.bimViewer.viewFitObjects(ids);
				
				var res = {
					count: ids.length,
					volume: totalVolume,
					area: totalArea
				};
				console.log(res);
				console.log("ids",ids);
				 

				if (document.referrer != "")
					window.parent.postMessage(["resultFilterBim",res], document.referrer);
				console.timeEnd("filterObjectProperty")
				
				
			//this.bimViewer.setSpacesShown(true);

				 
			break;
			
			case "generalProperties": 
				
				 //var json = JSON.parse(JSON.stringify(objects,this.getCircularReplacer()));
				

			/* 	 var temp = {};
				 var properties = {};

				 for (var j in json)
					{		
							console.log("metaModels=======>", json[j].metaModels)
						   temp = json[j].metaModels[0].metaScene.metaObjectsByType;
						   properties = json[j].metaModels[0].metaScene.propertySets;
					} */
				 /*
				  for (var j in json)
				 {		console.log("j",j)
						console.log("generalProperties json[j]", json[j])
						temp = json[j].metaModel.metaScene.metaObjectsByType;
						properties = json[j].metaModel.metaScene.propertySets;
				 }
				  console.log("myJson",filterObject);     // changement depuis last version bim24, remettre en place si utilisation de githubbim2/bim classique  (metaModel -> metaModels[0]) + (présence d'un undefined dans propertySets)
				 */
				/*var ids = [];
				var filterObject = e.data[1];
				var objects = this.viewer.metaScene.metaObjects;
				console.time("generalProperties xeokit");

				  console.log("filterObject",filterObject);
			
				 for (var k in objects)
				 {
					 var object = objects[k];
					 var propertySets = object.propertySets;
					 
					 for (var i in propertySets)
					 {			
						if(propertySets[i]){
						 var propertySet = propertySets[i];
						 if ( filterObject.bat.property != "classBim"){
							 if (propertySet.name == this.decode(filterObject.bat.section,true) || propertySet.name == this.decode(filterObject.bat.section,false))
							 {
								 var props = propertySet.properties
								  
										for (var c in props)
										{
											if (props[c].name == this.decode(filterObject.bat.property,true) || props[c].name == this.decode(filterObject.bat.property,false))
											{
												if (result.bat[this.decode(props[c].value)] != null)
													result.bat[this.decode(props[c].value)] += 1;
												else
													result.bat[this.decode(props[c].value)] = 1;		
											}
																		
										} 
							 }
						 
						}else{
							var buildings = this.viewer.metaScene.metaObjectsByType.IfcBuilding;
							 for (var s in buildings)
							 {
									result.bat[this.decode(buildings[s].name)] = 0;
									for(var m in buildings[s].metaModels){
										result.bat[this.decode(buildings[s].name)] = buildings[s].metaModels[m].metaObjects ? buildings[s].metaModels[m].metaObjects.length : 0;
									}
							}
						}
						  if ( filterObject.niveau.property != "classBim")
						  {
							  if (propertySet.name == this.decode(filterObject.niveau.section,true) || propertySet.name == this.decode(filterObject.niveau.section,false))
							 {
								 var props = propertySet.properties
								for (var c in props)
								{		
									if (props[c].name == this.decode(filterObject.niveau.property,true) || props[c].name == this.decode(filterObject.niveau.property,false))
									{
										if (result.niveau[this.decode(props[c].value,true)] != null)
											result.niveau[this.decode(props[c].value,true)] += 1;
										else
											result.niveau[this.decode(props[c].value,true)] = 1;		
									}
						
								} 
								
							 } 
						  }
						  else
						  {
							var storeys = this.viewer.metaScene.metaObjectsByType.IfcBuildingStorey;
							 for (var s in storeys)
							 {
								 result.niveau[this.decode(storeys[s].name)] = storeys[s].children ? storeys[s].children.length : 0;
							 }
							  
							  
						  }
						 if (propertySet.name == this.decode(filterObject.code.section,true) || propertySet.name == this.decode(filterObject.code.section,false))
						 {
							 var props = propertySet.properties
							for (var c in props)
							{
								if (props[c].name.toUpperCase() == this.decode(filterObject.code.property,true).toUpperCase())
								{
									if (result.code[this.decode(props[c].value)] != null)
										result.code[this.decode(props[c].value)] += 1;
									else
										result.code[this.decode(props[c].value)] = 1;		
								}		
									
							} 
							
						 }
						 for (var cu in filterObject.custom)
						 {
								if (propertySet.name == this.decode(filterObject.custom[cu].section.value,true) || propertySet.name == this.decode(filterObject.custom[cu].section.value,false))
								{
									var props = propertySet.properties
									for (var c in props)
									{
										if (props[c].name.toUpperCase() == this.decode(filterObject.custom[cu].property.value,true).toUpperCase() || props[c].name.toUpperCase() == this.decode(filterObject.custom[cu].property.value.toUpperCase(),false))
										{
											if (!result.custom)
												result.custom = {};
											if (!result.custom[cu])
												result.custom[cu] = {};
											if (!result.custom[cu][this.decode(props[c].value)]) 
												result.custom[cu][this.decode(props[c].value)] = 1;
											else
												result.custom[cu][this.decode(props[c].value)] += 1;	
											
										}		
											
									}
								}
							 
						 }
				
						}
					 }
				 } */
					 
			 // version optimisée validée
				
			var filterObject = e.data[1];
			var objects = this.viewer.metaScene.metaObjects;
			console.time("generalProperties xeokit");

			console.log("filterObject", filterObject);

			// Pré-calcul des valeurs décodées pour "bat"
			var batSectionTrue = this.decode(filterObject.bat.section, true);
			var batSectionFalse = this.decode(filterObject.bat.section, false);
			var batPropertyTrue = this.decode(filterObject.bat.property, true);
			var batPropertyFalse = this.decode(filterObject.bat.property, false);

			// Pré-calcul pour "niveau"
			var niveauSectionTrue = this.decode(filterObject.niveau.section, true);
			var niveauSectionFalse = this.decode(filterObject.niveau.section, false);
			var niveauPropertyTrue = this.decode(filterObject.niveau.property, true);
			var niveauPropertyFalse = this.decode(filterObject.niveau.property, false);

			// Pré-calcul pour "code"
			var codeSectionTrue = this.decode(filterObject.code.section, true);
			var codeSectionFalse = this.decode(filterObject.code.section, false);
			var codePropertyUpper = this.decode(filterObject.code.property, true).toUpperCase();

			// Pré-calcul pour "custom"
			var customDecoded = {};
			for (var cu in filterObject.custom) {
				customDecoded[cu] = {
					sectionTrue: this.decode(filterObject.custom[cu].section.value, true),
					sectionFalse: this.decode(filterObject.custom[cu].section.value, false),
					propertyTrue: this.decode(filterObject.custom[cu].property.value, true).toUpperCase(),
					propertyFalse: this.decode(filterObject.custom[cu].property.value, false).toUpperCase()
				};
			}

			// Parcours des objets
			for (var k in objects) {
				var object = objects[k];
				var propertySets = object.propertySets;

				for (var i in propertySets) {
					var propertySet = propertySets[i];
					if (!propertySet) continue;

					// Traitement pour "bat"
					if (filterObject.bat.property !== "classBim") {
						if (propertySet.name === batSectionTrue || propertySet.name === batSectionFalse) {
							var props = propertySet.properties;
							for (var c in props) {
								var prop = props[c];
								if (prop.name === batPropertyTrue || prop.name === batPropertyFalse) {
									var val = this.decode(prop.value);
									result.bat[val] = (result.bat[val] || 0) + 1;
								}
							}
						}
					} else {
						var buildings = this.viewer.metaScene.metaObjectsByType.IfcBuilding;
						for (var s in buildings) {
							var bName = this.decode(buildings[s].name);
							result.bat[bName] = 0;
							for (var m in buildings[s].metaModels) {
								var metaObjs = buildings[s].metaModels[m].metaObjects;
								result.bat[bName] = metaObjs ? metaObjs.length : 0;
							}
						}
					}

					// Traitement pour "niveau"
					if (filterObject.niveau.property !== "classBim") {
						if (propertySet.name === niveauSectionTrue || propertySet.name === niveauSectionFalse) {
							var props = propertySet.properties;
							for (var c in props) {
								var prop = props[c];
								if (prop.name === niveauPropertyTrue || prop.name === niveauPropertyFalse) {
									var val = this.decode(prop.value, true);
									result.niveau[val] = (result.niveau[val] || 0) + 1;
								}
							}
						}
					} else {
						var storeys = this.viewer.metaScene.metaObjectsByType.IfcBuildingStorey;
						for (var s in storeys) {
							var sName = this.decode(storeys[s].name);
							result.niveau[sName] = storeys[s].children ? storeys[s].children.length : 0;
						}
					}

					// Traitement pour "code"
					if (propertySet.name === codeSectionTrue || propertySet.name === codeSectionFalse) {
						var props = propertySet.properties;
						for (var c in props) {
							var prop = props[c];
							if (this.decode(prop.name).toUpperCase() === codePropertyUpper) {
								var val = this.decode(prop.value);
								result.code[val] = (result.code[val] || 0) + 1;
							}
						}
					}

					// Traitement pour "custom"
					for (var cu in filterObject.custom) {
						if (propertySet.name === customDecoded[cu].sectionTrue || propertySet.name === customDecoded[cu].sectionFalse) {
							var props = propertySet.properties;
							for (var c in props) {
								var prop = props[c];
								var propNameUpper = this.decode(prop.name).toUpperCase();
								if (propNameUpper === customDecoded[cu].propertyTrue || propNameUpper === customDecoded[cu].propertyFalse) {
									var val = this.decode(prop.value);
									if (!result.custom) result.custom = {};
									if (!result.custom[cu]) result.custom[cu] = {};
									result.custom[cu][val] = (result.custom[cu][val] || 0) + 1;
								}
							}
						}
					}
				}
			}
			console.timeEnd("generalProperties xeokit");

			
				if (document.referrer != "")
				window.parent.postMessage(["resultGeneralProperties",result], document.referrer);
				 //console.timeEnd("generalProperties xeokit");

			break;
			case "getBuildings":
			
				var buildings = this.viewer.metaScene.metaObjectsByType.IfcBuilding;
				 for (var s in buildings)
				 {
						result.bat[buildings[s].id] = new Object();
						result.bat[buildings[s].id].id = buildings[s].id;
						result.bat[buildings[s].id].name = this.decode(buildings[s].name);						 
					 
				 }
				
				 if (document.referrer != "")
					window.parent.postMessage(["resultGetBuildings",result], document.referrer);
			
			break;
			case "getStoreys":
			
				var storeys = this.viewer.metaScene.metaObjectsByType.IfcBuildingStorey;
				 for (var s in storeys)
				 {
					 if (e.data[1] == null || e.data[1] == e.data[1].parent.id)
					 {
						result.niveau[storeys[s].id] = new Object();
						result.niveau[storeys[s].id].id = storeys[s].id;
						result.niveau[storeys[s].id].name = this.decode(storeys[s].name);						 
					 }
					 
				 }
				
				 if (document.referrer != "")
					window.parent.postMessage(["resultGetStoreys",result], document.referrer);
			
			break;
			case "getSpaces":
			
				var spaces = this.viewer.metaScene.metaObjectsByType.IfcSpace;
				 for (var s in spaces)
				 {
					 if (e.data[1] == null || e.data[1] == spaces[s].parent.id)
					 {
						result.space[spaces[s].id] = new Object();
						result.space[spaces[s].id].id = spaces[s].id;
						result.space[spaces[s].id].name = this.decode(spaces[s].name);						 
					 }
					 
				 }
			
				 if (document.referrer != "")
					window.parent.postMessage(["resultGetSpaces",result], document.referrer);	
			break;
			case "getSpaceObjects":
			
				var objects = this.viewer.metaScene.metaObjects[e.data[1]].children;
				if (!objects || objects.length == 0)
				{
					objects = this.viewer.metaScene.metaObjects[e.data[1]].parent.children;
					result.noObject = true;
				}
				console.log(this.viewer.metaScene.metaObjects[e.data[1]]);
				console.log(this.viewer.metaScene.metaObjects[e.data[1]].parent);
					
				 for (var s in objects)
				 {
					 if (objects[s].type != "IfcSpace" )
					 {
						result.object[objects[s].id] = new Object();
						result.object[objects[s].id].id = objects[s].id;
						result.object[objects[s].id].name = this.decode(objects[s].name);	
					 }
				 }
			
				 if (document.referrer != "")
					window.parent.postMessage(["resultGetSpaceObjects",result], document.referrer);	
			break;
			case "getDbObjectAndCountProperties":
				console.time("getDbObjectAndCountProperties xeokit")
					console.log("scene = ",this.scene);
					var buildings = this.viewer.metaScene.metaObjectsByType.IfcBuilding;
					console.log("buildings",buildings)
					var MYstoreys = this.viewer.metaScene.metaObjectsByType.IfcBuildingStorey;
					console.log("MYstoreys",MYstoreys)
					// Récupération du filterObject et des objets
					var filterObject = e.data[1];
					var allObjects = this.viewer.metaScene.metaObjects;
					
					// --- Pré-calculs pour le traitement général ---
					var batSectionTrue   = this.decode(filterObject.bat.section, true);
					var batSectionFalse  = this.decode(filterObject.bat.section, false);
					var batPropertyTrue  = this.decode(filterObject.bat.property, true);
					var batPropertyFalse = this.decode(filterObject.bat.property, false);
				
					var niveauSectionTrue   = this.decode(filterObject.niveau.section, true);
					var niveauSectionFalse  = this.decode(filterObject.niveau.section, false);
					var niveauPropertyTrue  = this.decode(filterObject.niveau.property, true);
					var niveauPropertyFalse = this.decode(filterObject.niveau.property, false);
				
					var codeSectionTrue   = this.decode(filterObject.code.section, true);
					var codeSectionFalse  = this.decode(filterObject.code.section, false);
					var codePropertyUpper = this.decode(filterObject.code.property, true);//.toUpperCase();
				
					// Pour "custom"
					var customDecoded = {};
					for (var cu in filterObject.custom) {
						customDecoded[cu] = {
							sectionTrue:  this.decode(filterObject.custom[cu].section.value, true),
							sectionFalse: this.decode(filterObject.custom[cu].section.value, false),
							propertyTrue: this.decode(filterObject.custom[cu].property.value, true),//.toUpperCase(),
							propertyFalse:this.decode(filterObject.custom[cu].property.value, false)//.toUpperCase()
						};
					}
				
					// --- Pré-calculs pour le traitement détaillé (calcul area et volume) ---
					var calculSection           = this.decode(filterObject.calcul.section, true);
					var calculPropertyAreaTrue  = this.decode(filterObject.calcul.propertyArea, true)//.toUpperCase();
					var calculPropertyAreaFalse = this.decode(filterObject.calcul.propertyArea, false)//.toUpperCase();
					var calculPropertyVolumeTrue  = this.decode(filterObject.calcul.propertyVolume, true)//.toUpperCase();
					var calculPropertyVolumeFalse = this.decode(filterObject.calcul.propertyVolume, false)//.toUpperCase();
				
					// Initialisation des résultats
					var resultGeneral = {
						bat:    {},
						niveau: {},
						code:   {},
						custom: {}
					};
				
					var resultDetail = { sections: {} };
					var classIFCTab  = [];
					var classIfCData = {};
				
					// Boucle unique sur tous les objets
					for (var k in allObjects) {
						var object = allObjects[k];
						var propertySets = object.propertySets;
						if (!propertySets) continue;
				
						// Variables pour le traitement détaillé de cet objet
						var oVolume = 0, oArea = 0;
						var bat = null, niveau = null, code = "classBim"; // valeur par défaut
				
						// Si le filtre demande "classBim" pour bat ou niveau, monter dans la hiérarchie
						if (filterObject.bat.property === "classBim" || filterObject.niveau.property === "classBim") {
							var parentTemp = object;
							while (!bat && parentTemp) {
								if (parentTemp.type === "IfcBuilding") {
									bat = parentTemp.name == "IfcBuilding" ? parentTemp.id : parentTemp.name;
									if(parentTemp.metaModels[0].id)
										var filebimid = parentTemp.metaModels[0].id;
								}
								if (parentTemp.type === "IfcBuildingStorey") {
									niveau = parentTemp.name == "IfcBuildingStorey" ? parentTemp.id : parentTemp.name;

								}
								parentTemp = parentTemp.parent;
							}

							
							
						}
					// --- Traitement général ---
								// Pour "classBim", si l'objet est un IfcBuilding, le traiter directement // pourquoi c'est pas au dessus de la boucle sur les PSET ??? à voir
								if (object.type === "IfcBuilding") {
									console.log("current bulding trouver les childrens",object)
									var bName = this.decode(object.name);
									if(bName == "IfcBuilding")
										bName = this.decode(object.id);
									var count = 0;
									if (object.metaModels) {
										for (var m in object.metaModels) {
											var metaObjs = object.metaModels[m].metaObjects;
											count += metaObjs ? metaObjs.length : 0;
										}
									}
									if(!resultGeneral.bat[bName])
										resultGeneral.bat[bName] = count;
									else
										resultGeneral.bat[bName] += count;
								}
							
				
							// Traitement pour "niveau"
							
								if (object.type === "IfcBuildingStorey") {
									var sName = this.decode(object.name);
									if(!resultGeneral.niveau[sName])
										resultGeneral.niveau[sName] = object.children ? object.children.length : 0;
									else
										resultGeneral.niveau[sName] += object.children ? object.children.length : 0; //si meme nom de storey dans pls maquettes

								}
							
						// Parcours de tous les propertySets de l'objet
						for (var i in propertySets) {
							var propertySet = propertySets[i];
							if (!propertySet) continue;
				
							
				
							// Traitement pour "code"
							if (propertySet.name === codeSectionTrue || propertySet.name === codeSectionFalse) {
								var props = propertySet.properties;
								for (var c in props) {
									var prop = props[c];
									if (this.decode(prop.name) === codePropertyUpper) {
										var val = this.decode(prop.value);
										resultGeneral.code[val] = (resultGeneral.code[val] || 0) + 1;
									}
								}
							}
				
							// Traitement pour "custom"
							for (var cu in filterObject.custom) {
								if (propertySet.name === customDecoded[cu].sectionTrue || propertySet.name === customDecoded[cu].sectionFalse) {
									var props = propertySet.properties;
									for (var c in props) {
										var prop = props[c];
										var propNameUpper = this.decode(prop.name);
										if (propNameUpper === customDecoded[cu].propertyTrue || propNameUpper === customDecoded[cu].propertyFalse) {
											var val = this.decode(prop.value);
											if (!resultGeneral.custom[cu]) resultGeneral.custom[cu] = {};
											resultGeneral.custom[cu][val] = (resultGeneral.custom[cu][val] || 0) + 1;
										}
									}
								}
							}
				
							// --- Traitement détaillé (sections, calcul area/volume) ---
				
							// Récupération ou création de la section dans resultDetail
							var sectionName = this.decode(propertySet.name);
							if (!resultDetail.sections[sectionName]) {
								resultDetail.sections[sectionName] = { properties: {} };
							}
				
							// Stockage d'informations complémentaires par type et section
							if (!classIfCData[object.type])
								classIfCData[object.type] = {};
							if (classIFCTab.indexOf(object.type) === -1)
								classIFCTab.push(object.type);
							if (!classIfCData[object.type][sectionName])
								classIfCData[object.type][sectionName] = [];
				
							var props = propertySet.properties;
							for (var c in props) {
								var propName = this.decode(props[c].name);
								if (classIfCData[object.type][sectionName].indexOf(propName) === -1)
									classIfCData[object.type][sectionName].push(propName);
								if (!resultDetail.sections[sectionName].properties[propName]) {
									resultDetail.sections[sectionName].properties[propName] = {};
								}
								// Si c'est la section de calcul, récupérer area et volume
								if (propertySet.name === calculSection) {
									if (props[c].name === calculPropertyAreaTrue || props[c].name === calculPropertyAreaFalse) {
										oArea = Number(props[c].value);
									}
									if (props[c].name === calculPropertyVolumeTrue || props[c].name === calculPropertyVolumeFalse) {
										oVolume = Number(props[c].value);
									}
								}
							}
				
							// Recherche d'informations bat, niveau et code dans les propertySets
							if (propertySet.name === this.decode(filterObject.bat.section, true) ||
								propertySet.name === this.decode(filterObject.bat.section, false)) {
								var props = propertySet.properties;
								for (var c in props) {
									if (props[c].name === this.decode(filterObject.bat.property, true) ||
										props[c].name === this.decode(filterObject.bat.property, false)) {
										bat = props[c].value;
									}
								}
							}
							if (propertySet.name === this.decode(filterObject.niveau.section, true) ||
								propertySet.name === this.decode(filterObject.niveau.section, false)) {
								var props = propertySet.properties;
								for (var c in props) {
									if (props[c].name === this.decode(filterObject.niveau.property, true) ||
										props[c].name === this.decode(filterObject.niveau.property, false)) {
										niveau = props[c].value;
									}
								}
							}
							if (propertySet.name === this.decode(filterObject.code.section, true) ||
								propertySet.name === this.decode(filterObject.code.section, false)) {
								var props = propertySet.properties;
								for (var c in props) {
									if (props[c].name === this.decode(filterObject.code.property, true) ||
										props[c].name === this.decode(filterObject.code.property, false)) {
										code = props[c].value;
									}
								}
							}
						} // Fin du parcours des propertySets
				
						// Agrégation détaillée par bat / niveau / code à retirer ??? ou à merger avec la boucle plus haut 
						if (bat) {
							console.log()
							if (!resultDetail[bat]){
								resultDetail[bat] = {};
								if(filebimid)
									resultDetail[bat].filebimid = filebimid;
							}
							if (niveau) {
								if (!resultDetail[bat][niveau])
									resultDetail[bat][niveau] = {};
								if (code) {
									if (!resultDetail[bat][niveau][code]) {
										resultDetail[bat][niveau][code] = { count: 0, area: 0, volume: 0, objects: {} };
									}
									resultDetail[bat][niveau][code].objects[object.id] = {
										guid:   object.id,
										name:   object.name,
										area:   oArea,
										volume: oVolume
									};
									resultDetail[bat][niveau][code].area   += oArea;
									resultDetail[bat][niveau][code].volume += oVolume;
									resultDetail[bat][niveau][code].count++;
								}
							}
						}
					} // Fin de la boucle sur tous les objets


					//retirer les objets non physique de resultGeneral

					var mergedResult = {};
					mergedResult.generalProperties = resultGeneral;
					mergedResult.detailedSections = resultDetail;

					mergedResult.classIFCTypes = classIFCTab;
					mergedResult.classIFCData = classIfCData;
					console.log("mergedResult",mergedResult);
					
					console.timeEnd("getDbObjectAndCountProperties xeokit")
					if (document.referrer != "")
						window.parent.postMessage(["resultgetDbObjectAndCountProperties",mergedResult], document.referrer);


			break;
			case "getDbObjects": 
				console.time("getDbObjects xeokit");
				var ids = [];
				var filterObject = e.data[1];
				
				var volume = 0;
				var area = 0;
				var objects = [];
				var result = [];
				result.sections = {};
				var tempXrayed = scene.xrayedObjectIds;
				var classIFCTab = [];
				var classIfCData = {};
				 console.log("tempXrayed",tempXrayed)
				 objects = this.viewer.metaScene.metaObjects;
				 if (e.data[3] == "global" || e.data[3] == "globalExtract"){
					console.log("global");
					var visibleObjects = objects;
				 }else{
					
					scene.setObjectsVisible(scene.xrayedObjectIds, false);
				
				 	var visibleObjects = scene.visibleObjectIds;
				 }
				 for (var k in visibleObjects)
				 {
					
					
					if (e.data[3] == "global" || e.data[3] == "globalExtract"){
						var object = visibleObjects[k];
					}else{
					 	var object = objects[visibleObjects[k]];
					}
					 var propertySets = object.propertySets;
					 var oVolume = 0
				     var oArea = 0;
					 var bat = null;
					 var niveau = null;
					 var code = null;
					 if(!classIfCData[object.type])
					 	classIfCData[object.type] = {};
					
					 if(classIFCTab.indexOf(object.type) == -1)
					 	classIFCTab.push(object.type);
					 if ( filterObject.bat.property == "classBim" || filterObject.niveau.property == "classBim")
							{
								var parentTemp = object;
								while(!bat && parentTemp)
								{
									if (parentTemp.type == "IfcBuilding"){
										bat = parentTemp.name;
									}
									if (parentTemp.type == "IfcBuildingStorey"){
										niveau = parentTemp.name;
									}
										
									parentTemp = parentTemp.parent;
								} 		

							}
							code = "classBim";
					 
					for (var i in propertySets)
						 {	
							
						if(propertySets[i]){
							var propertySet = propertySets[i];
							var sectionName = this.decode(propertySet.name);
							if(!classIfCData[object.type][sectionName])
								classIfCData[object.type][sectionName] = [];
							if (!result.sections[sectionName])
							{
								result.sections[sectionName] = {};
								result.sections[sectionName].properties = {};
							}
							
							
								var props = propertySet.properties
								for (var c in props)
								{
									var propertyName = this.decode(props[c].name)
									if(classIfCData[object.type][sectionName].indexOf(propertyName) == -1)
										classIfCData[object.type][sectionName].push(propertyName);
									if (!result.sections[sectionName].properties[propertyName])
									{
									result.sections[sectionName].properties[propertyName] = {};

									}
									if (propertySet.name == this.decode(filterObject.calcul.section,true))
									{
									if(props[c].name.toUpperCase() == this.decode(filterObject.calcul.propertyArea,true).toUpperCase() || props[c].name.toUpperCase() == this.decode(filterObject.calcul.propertyArea,false).toUpperCase() )
											oArea = Number(props[c].value);
											if(props[c].name.toUpperCase() == this.decode(filterObject.calcul.propertyVolume,true).toUpperCase() || props[c].name.toUpperCase() == this.decode(filterObject.calcul.propertyVolume,false).toUpperCase() )	
										oVolume = Number(props[c].value);
									} 
							}

							
							
							if (propertySet.name == this.decode(filterObject.bat.section,true) || propertySet.name == this.decode(filterObject.bat.section,false))
							{
								var props = propertySet.properties
								for (var c in props)
								{
									if (props[c].name.toUpperCase() == this.decode(filterObject.bat.property,true).toUpperCase() || props[c].name.toUpperCase() == this.decode(filterObject.bat.property,false).toUpperCase())
									bat = props[c].value;
									
								} 
							}
							if (propertySet.name == this.decode(filterObject.niveau.section,true) || propertySet.name == this.decode(filterObject.niveau.section,false))
							{
								var props = propertySet.properties
								for (var c in props)
								{
									if (props[c].name.toUpperCase() == this.decode(filterObject.niveau.property,true).toUpperCase() || props[c].name.toUpperCase() == this.decode(filterObject.niveau.property,false).toUpperCase())
									niveau = props[c].value;
									
								} 
							}
							if (propertySet.name == this.decode(filterObject.code.section,true) || propertySet.name == this.decode(filterObject.code.section,false))
							{
								var props = propertySet.properties
								for (var c in props)
								{
									if (props[c].name.toUpperCase() == this.decode(filterObject.code.property,true).toUpperCase() || props[c].name.toUpperCase() == this.decode(filterObject.code.property,false).toUpperCase())	
									code = props[c].value;
									
								} 
							}
						 
						} 
					 }
				
					 if (bat){
						  if (!result[bat])
						  result[bat] = {};
						  if (niveau){
							if (!result[bat][niveau])
							result[bat][niveau]= {};
							if (code){
								if (!result[bat][niveau][code])
								{
								result[bat][niveau][code]= {};
								result[bat][niveau][code].count = 0;
								result[bat][niveau][code].area = 0;
								result[bat][niveau][code].volume = 0;
								}
								if (!result[bat][niveau][code]["objects"])
								result[bat][niveau][code]["objects"]= {};

								result[bat][niveau][code]["objects"][object.id] ={};
								result[bat][niveau][code]["objects"][object.id].guid =object.id;
								result[bat][niveau][code]["objects"][object.id].name = object.name
								result[bat][niveau][code]["objects"][object.id].area = oArea;
								result[bat][niveau][code]["objects"][object.id].volume = oVolume;
								result[bat][niveau][code].area += oArea;
								result[bat][niveau][code].volume += oVolume;
								result[bat][niveau][code].count++;

							}
						  }
						
					}
					 
					}
					
					//result["classIFC"] = classIFCTab;
					 	 
						 
					scene.setObjectsVisible(tempXrayed, true);
					scene.setObjectsXRayed(tempXrayed, true); //remet les xrayed enlevés pour l'extractExcel
				console.log("=================getDbObject avant postMessage================")
				 console.log("result =  ",result);
		
				 if (document.referrer != "")
					window.parent.postMessage(["resultGetDbObjects",result,e.data[3],classIFCTab,classIfCData], document.referrer);
				 console.timeEnd("getDbObjects xeokit");
				break;
				/* case: "VerifExtractExcel";
				
				var verifObj = e.data[1];

				objects = this.viewer.metaScene.metaObjects;

				if (e.data[3] == "global" || e.data[3] == "globalExtract"){
					console.log("global");
					var visibleObjects = objects;
				 }else{
					
					scene.setObjectsVisible(scene.xrayedObjectIds, false);
				
				 	var visibleObjects = scene.visibleObjectIds;
				 }

				 for (var k in visibleObjects)
				 {
				
					
					if (e.data[3] == "global" || e.data[3] == "globalExtract"){
						var object = visibleObjects[k];
					}else{
					 	var object = objects[visibleObjects[k]];
					}

				}

				break; */
				case "getDbExcel": 
			
				var ids = [];
				var filterObject = e.data[1];
				
				var volume = 0;
				var area = 0;
				var objects = [];
				var result = {};
			
				if(filterObject.customExtract){ //remplacer par customExtract , sous forme de liste d'object comme obim.custom (fait)
					result.custom = {};
					for (var cu in filterObject.customExtract)
					{
						result.custom[cu] ={};
					}
				}
				

				var tempXrayed = scene.xrayedObjectIds;
				 objects = this.viewer.metaScene.metaObjects;
				 if (e.data[3] == "global" || e.data[3] == "globalExtract"){
					console.log("global");
					var visibleObjects = objects;
				 }else{
					
					scene.setObjectsVisible(scene.xrayedObjectIds, false);
				
				 	var visibleObjects = scene.visibleObjectIds;
				 }
				 for (var k in visibleObjects)
				 {
				
					
					if (e.data[3] == "global" || e.data[3] == "globalExtract"){
						var object = visibleObjects[k];
					}else{
					 	var object = objects[visibleObjects[k]];
					}
					var customTemp = {}
					//console.log("object",object);
					 var propertySets = object.propertySets;
					 var oVolume = 0
				     var oArea = 0;
					 var bat;
					 var niveau;
					 var code;
					 var objectId = object.id;
					 var objectName = object.name;
					 var objectType = object.type; 
					 //var entity = this.viewer.scene.getEntity(objectId);
					 
					 
				
					
					for (var i in propertySets)
						 {			
							if(propertySets[i]){
								var propertySet = propertySets[i];
								var sectionName = this.decode(propertySet.name);
							
							
							
							
								var props = propertySet.properties
								for (var c in props)
								{
									var propertyName = this.decode(props[c].name)
									
									if (propertySet.name == this.decode(filterObject.calcul.section,true) || propertySet.name == this.decode(filterObject.calcul.section,false))
									{
									if(props[c].name.toUpperCase() == this.decode(filterObject.calcul.propertyArea,true).toUpperCase() || props[c].name.toUpperCase() == this.decode(filterObject.calcul.propertyArea,false).toUpperCase())
											oArea = Number(props[c].value);
											if(props[c].name.toUpperCase() == this.decode(filterObject.calcul.propertyVolume,true).toUpperCase() || props[c].name.toUpperCase() == this.decode(filterObject.calcul.propertyVolume,false).toUpperCase())	
										oVolume = Number(props[c].value);
									} 
							}
							if ( filterObject.bat.property == "classBim" || filterObject.niveau.property == "classBim")
							{
								var currentO = object;
								while(currentO != null)
								{
									if(currentO.type == "IfcBuilding" && filterObject.bat.property == "classBim" )
									{
										bat = currentO.name;
										
									}
									if(currentO.type == "IfcBuildingStorey" && filterObject.niveau.property == "classBim")
									{
										niveau = currentO.name;
										
									}
									
										currentO = currentO.parent;
										
								}
							}
							
								if (!bat && propertySet.name == this.decode(filterObject.bat.section,true) || propertySet.name == this.decode(filterObject.bat.section,false))
								{
									bat = "";
									var props = propertySet.properties
									for (var c in props)
									{
										if (props[c].name.toUpperCase() == this.decode(filterObject.bat.property,true).toUpperCase() || props[c].name.toUpperCase() == this.decode(filterObject.bat.property,false).toUpperCase())
										bat = props[c].value;
										
									} 
								}
							
							
								if (!niveau && propertySet.name == this.decode(filterObject.niveau.section,true) || propertySet.name == this.decode(filterObject.niveau.section,false))
								{
									niveau = "";
									var props = propertySet.properties
									for (var c in props)
									{
										if (props[c].name.toUpperCase() == this.decode(filterObject.niveau.property,true).toUpperCase() || props[c].name.toUpperCase() == this.decode(filterObject.niveau.property,false).toUpperCase())
										niveau = props[c].value;
										
									} 
								}
							
							if (propertySet.name == this.decode(filterObject.code.section,true) || propertySet.name == this.decode(filterObject.code.section,false))
							{
								code ="";
								var props = propertySet.properties
								for (var c in props)
								{
									if (props[c].name.toUpperCase() == this.decode(filterObject.code.property,true).toUpperCase() || props[c].name.toUpperCase() == this.decode(filterObject.code.property,false).toUpperCase())
									code = props[c].value;
									
								} 
							}

							if(filterObject.customExtract){
							

								for (var cu in filterObject.customExtract)
								{
									if (propertySet.name == this.decode(filterObject.customExtract[cu].section.value,true) || propertySet.name == this.decode(filterObject.customExtract[cu].section.value,false))
										{
											var props = propertySet.properties
											for (var c in props)
											{
												if (props[c].name.toUpperCase() == this.decode(filterObject.customExtract[cu].property.value,true).toUpperCase() || props[c].name.toUpperCase() == this.decode(filterObject.customExtract[cu].property.value,false).toUpperCase())
												customTemp[cu] = props[c].value;
												
											} 
										}
									


								}


							}
						 
						
						}
					 }
					 	
							 result[objectId] ={};
							result[objectId].guid =objectId;
							result[objectId].name = objectName
							result[objectId].area = oArea;
							result[objectId].volume = oVolume;
							result[objectId].ifcId = object.metaModels[0].id
							result[objectId].bat = bat ? bat : "";
							result[objectId].niveau = niveau ? niveau : "";
							result[objectId].code = code ? code :"";
							result[objectId].type = objectType; //ifcClass
							for (var ct in customTemp)
							{
								result[objectId][ct] = customTemp[ct] ? customTemp[ct] : "";
							}

					} 
					 
					
							
					 	 
						 
					scene.setObjectsVisible(tempXrayed, true);
					scene.setObjectsXRayed(tempXrayed, true); //remet les xrayed enlevés pour l'extractExcel

					console.log('result prepare Excel', result);
					if (document.referrer != "")
					window.parent.postMessage(["resultGetDbExcel",result,e.data[3]], document.referrer);
				break;
				case "generateBCF":
					var tmpWrayed = scene.xrayedObjectIds;
					scene.setObjectsXRayed(tmpWrayed, false);
					scene.setObjectsVisible(tmpWrayed, false);
					//sauvegarder les xrayedObject dans le bcf comme ca on peut les rendre invisible a chaque load
				
						const bcfViewpoints = new BCFViewpointsPlugin(this.viewer);
						const viewpoint = bcfViewpoints.getViewpoint({ // Options
							spacesVisible: false, // Don't force IfcSpace types visible in viewpoint (default)
							spaceBoundariesVisible: false, // Don't show IfcSpace boundaries in viewpoint (default)
							openingsVisible: false // Don't force IfcOpening types visible in viewpoint (default)
						});
						
						const viewpointStr = JSON.stringify(viewpoint, null, 4);
						this.lastViewPoint = viewpointStr;
						console.log("viewpointStr",viewpointStr);
						window.parent.postMessage(["resultgenerateBCF",viewpointStr], document.referrer);
				break;
				case "generateBCFforVerif":
					console.log("tabs triple bcf",e.data[1]);
					var tmpWrayed = scene.xrayedObjectIds;
					var visibleObj = scene.visibleObjectIds;
					scene.setObjectsXRayed(tmpWrayed, false);
					scene.setObjectsVisible(tmpWrayed, false);
					var viewpointStr3;

					const bcfViewpoints3 = new BCFViewpointsPlugin(this.viewer);
						const viewpoint3 = bcfViewpoints3.getViewpoint({ // Options
							spacesVisible: false, // Don't force IfcSpace types visible in viewpoint (default)
							spaceBoundariesVisible: false, // Don't show IfcSpace boundaries in viewpoint (default)
							openingsVisible: false // Don't force IfcOpening types visible in viewpoint (default)
						});
			
						viewpointStr3 = JSON.stringify(viewpoint3, null, 4);
						this.lastViewPoint = viewpointStr3;
						console.log("viewpointStr",viewpointStr3);
				
					//data et snapshots OK ! 
					window.parent.postMessage(["resultgenerateBCFforVerif",viewpointStr3], document.referrer);
					//sauvegarder les xrayedObject dans le bcf comme ca on peut les rendre invisible a chaque load
					
					//restaure objects visibles à la base :
					var objects = this.viewer.metaScene.metaObjects;
					var tmpWrayed = scene.xrayedObjectIds;
					
					scene.setObjectsVisible(visibleObj, true);
					
						
				break;
				case "generateBCFforPreview":
							console.log("tabs triple bcf",e.data[1]);
					var tmpWrayed = scene.xrayedObjectIds;
					var visibleObj = scene.visibleObjectIds;
					scene.setObjectsXRayed(tmpWrayed, false);
					scene.setObjectsVisible(tmpWrayed, false);
					var viewpointStr3;

					const bcfViewpoints4 = new BCFViewpointsPlugin(this.viewer);
						const viewpoint4 = bcfViewpoints4.getViewpoint({ // Options
							spacesVisible: false, // Don't force IfcSpace types visible in viewpoint (default)
							spaceBoundariesVisible: false, // Don't show IfcSpace boundaries in viewpoint (default)
							openingsVisible: false // Don't force IfcOpening types visible in viewpoint (default)
						});
			
						viewpointStr3 = JSON.stringify(viewpoint4, null, 4);
						this.lastViewPoint = viewpointStr3;
						console.log("viewpointStr",viewpointStr3);
				
					//data et snapshots OK ! 
					window.parent.postMessage(["resultgenerateBCFforPreview",viewpointStr3], document.referrer);
					//sauvegarder les xrayedObject dans le bcf comme ca on peut les rendre invisible a chaque load
					
					//restaure objects visibles à la base :
					var objects = this.viewer.metaScene.metaObjects;
					var tmpWrayed = scene.xrayedObjectIds;
					
					scene.setObjectsVisible(visibleObj, true);

				break;
				
				case "loadBCF":

					
					const bcfViewpoints2 = new BCFViewpointsPlugin(this.viewer);
				
					if(e.data[1]){
						bcfViewpoints2.setViewpoint(JSON.parse(e.data[1]),{
							immediate:false,
							rayCast:false
						}); 
					}else
						alert("No BCF viewpoint to load");
					console.log("loadedBCF");
				break;
			 	case "testcolors":
					 console.log("objects",this.viewer.scene.objects)
					var objs = this.viewer.scene.objects;
					var mymeshes;	
						// Show all objects
						console.log("objects",this.viewer.scene.objects);
						 this.viewer.scene.setObjectsVisible(this.viewer.scene.objectIds, true);
				   
						// Restore the objects states again, which involves hiding those two objects again
						this.objectsMemento.restoreObjects(this.viewer.scene); 

						// Show all objects
						console.log(this.viewer.scene.model)
				break; 
				case "verifEachObject2":
					console.time("verifEachObject")

					console.log("====================verifEachObject2=======================");
					var objects = this.viewer.metaScene.metaObjects;
					console.log("objects",objects);
					var verifObj = e.data[1];
					console.log("TYPE OF verifObj====================================",typeof verifObj);
					var caseSensitive = e.data[3];
					var uniqueTestDisplay = e.data[4];
					console.log("verifObj",verifObj);
					var resultErrorObj = new Object();
					var objectErrorTab = [];
					var cptVerif = 0;
					var cpttargeted = 0;

					for(var o in objects){
						var isObjAllGood = true;
						var alreadyColorizedObj = false;
						var object = objects[o];

						for(var v in verifObj){
							//resultErrorObj[v] = new Object();
							var target = verifObj[v].target;
							var details = verifObj[v].elemLinesVerif;
							var ref = verifObj[v].ref;
							var originalColor = verifObj[v].color;
							var targetDataType = verifObj[v].dataType;
							if(verifObj[v].color && verifObj[v].color != undefined)
								var color = this.convertColorFormat(verifObj[v].color);
							/* if(target.mainTarget == "visibleObj"){
								var isGlobal = false;
								scene.setObjectsVisible(scene.xrayedObjectIds, false);
								var targetObjects = scene.visibleObjectIds;
							}else if(target.mainTarget == "allObj"){
								var isGlobal = true;
								this.bimViewer.resetView();
								var targetObjects = objects;
							}else */ 
							if(target.mainTarget == "contains"){
									/* if(target.section == "none" && target.property == "none" && target.ifcClass == "none" && target.value == "none" && target.valueMax == "none"){
										console.log("no target donc global");
										var isGlobal = true;
										this.bimViewer.resetView();
										var targetObjects = objects;
									}else{ */
										
										var targetObj = {};
										var isTargeted = true;
										if(target.section != "none" || target.ifcClass !="none"){ //si aucun des deux n'est spécifié c'est forcément targetted 
											if(target.section != "none") targetObj.section = false;
											if(target.property != "none") targetObj.property = false;
											if(target.ifcClass != "none") targetObj.ifcClass = false;
											if(target.value != "none" || target.valueEnum != "none") targetObj.value = false;
											//if(target.dataType != "none") targetObj.dataType = false;
											//console.log("targetObj à respecter", targetObj)

											if(!caseSensitive){
												var objectType = object.type.toLowerCase();
												var targetIfcClass = target.ifcClass.toLowerCase();
											}else{
												var objectType = object.type;
												var targetIfcClass = target.ifcClass;
											}

											if(objectType == this.decode(targetIfcClass,true) || objectType == this.decode(targetIfcClass,false)){
												targetObj.ifcClass = true;
											}
											for(var p in object.propertySets){
												if(object.propertySets[p]){
													var propertySet = object.propertySets[p];
													if(!caseSensitive){
														var propertySetName = propertySet.name.toLowerCase();
														var targetSection = target.section.toLowerCase();
													}else{
														var propertySetName = propertySet.name;
														var targetSection = target.section;
													}
													if( propertySet != undefined && (propertySetName == this.decode(targetSection,true) || propertySetName == this.decode(targetSection,false))){
														targetObj.section = true;
														for(var pr in propertySet.properties){
															if(propertySet.properties[pr]){
																var prop = propertySet.properties[pr];
																if(!caseSensitive){
																	var propName = prop.name.toLowerCase();
																	var targetProp = target.property.toLowerCase();
																}else{
																	var propName = prop.name;
																	var targetProp = target.property;
																}
																if(propName == this.decode(targetProp,true) || propName == this.decode(targetProp,false)){
																	targetObj.property = true;
																	if(!caseSensitive && isNaN(prop.value)){
																		var propValue = prop.value.toLowerCase();
																		var targetValue = target.value.toLowerCase();
																		if(target.type == "énumération"){
																			targetValue = [];
																			for(var e in target.valueEnum){
																				targetValue.push(target.valueEnum[e.toLowerCase()]);
																			}
																		}
																	}else{
																		var propValue = prop.value;
																		var targetValue = target.value;
																		if(target.type == "énumération"){
																			targetValue = target.valueEnum;
																		}
																	}
																	switch(target.type){ 
																		case "égal à":
																			if(propValue == targetValue || propValue == this.decode(targetValue,true) || propValue == this.decode(targetValue,false)){
																				targetObj.value = true;
																			}
																		break;
																		case "superieur à":
																			if(Number(prop.value) > Number(target.value)){
																				targetObj.value = true;
																			}
																		break;
																		case "inferieur à":
																			if(Number(prop.value) < Number(target.value)){
																				targetObj.value = true;
																			}
																		break;
																		case "contient":
																			propValue = propValue.toString();
																			targetValue = targetValue.toString();
																			if(propValue.indexOf(this.decode(targetValue,true)) != -1 || propValue.indexOf(this.decode(targetValue,false)) != -1){
																				targetObj.value = true;
																			}
																		break;
																		case "dans l'intervalle":
																			if(this.isANumber(prop.value) && this.isANumber(target.value) && this.isANumber(target.valueMax)){
																				if(Number(prop.value) >= Number(target.value) && Number(prop.value) <= Number(target.valueMax)){
																					targetObj.value = true;
																				}
																			}else{
																				console.log("une des valeurs n'est pas un number",prop.value,target.value,target.valueMax)
																			}
																		break;
																		case "énumération":

																			for(var a in targetValue){
																				if(propValue == targetValue[a] || propValue == this.decode(targetValue[a],true) || propValue == this.decode(targetValue[a],false)){
																					targetObj.value = true;
																				}
																			}
																		break;
																		case "pattern":
																			propValue = propValue.toString();
																			if(propValue.match(targetValue) || propValue.match(this.decode(targetValue,true)) || propValue.match(this.decode(targetValue,false))){ //attention à vérifier parce que pattern est sensible !!!
																				targetObj.value = true;
																			}
																		break;
																		default:
																			console.log("pas de type attention !! égal à par défaut")
																			if(propValue == targetValue || propValue == this.decode(targetValue,true) || propValue == this.decode(targetValue,false)){
																				targetObj.value = true;
																			}
																		break;
																	}
																}
															}
														}
													}
												}
											}
											for(var t in targetObj){
												if(targetObj[t] == false){
													isTargeted = false;
													break;
												}
											}
										}
											
												 //si un seul détail n'est pas respecté alors on ne l'ajoute pas au tableau d'erreur
												for(var d in details){
													var allDetailsRespected = true;
													if(!resultErrorObj[v]){
													resultErrorObj[v] = new Object();
													}
													if (!resultErrorObj[v][d]) {
														resultErrorObj[v][d] = {}; // Idem ici
													}
													resultErrorObj[v][d].id = d;
													if(!resultErrorObj[v][d].validObjects){
														resultErrorObj[v][d].validObjects = [];
													}
													if(!resultErrorObj[v][d].errorObjects){
														resultErrorObj[v][d].errorObjects = [];
													}
													resultErrorObj[v][d].color = originalColor;
													resultErrorObj[v][d].elemLinesVerif = details[d];
													resultErrorObj[v][d].target = target;
													resultErrorObj[v][d].ref = ref;
												if(isTargeted){ //Test tendu
														cpttargeted++;
													var validDetailObj = {};
													
													var detailSection = details[d].section;
													var detailProperty = details[d].property;
													var detailValue = details[d].value;
													var detailValueMax = details[d].valueMax;
													var detailValueEnum = details[d].valueEnum;
													var detailType = details[d].type;
													var detailDataType = details[d].dataType;
													var detailCardinality = details[d].cardinality;
													if(detailSection != "none") validDetailObj.section = false;
													if(detailProperty != "none") validDetailObj.property = false;
													if(detailValue != "none" || detailValueEnum != "none") validDetailObj.value = false;

													for(var p in object.propertySets){
														if(object.propertySets[p]){
															var propertySet = object.propertySets[p];
															if(!caseSensitive){
																var propertySetName = propertySet.name.toLowerCase();
																detailSection = detailSection.toLowerCase();
																
															}else{
																var propertySetName = propertySet.name;
																detailSection = detailSection;
															}
															if( propertySet != undefined && (propertySetName == this.decode(detailSection,true) || propertySetName == this.decode(detailSection,false))  ){
																
																validDetailObj.section = true;
																for(var pr in propertySet.properties){
																	if(propertySet.properties[pr]){
																		var prop = propertySet.properties[pr];
																		if(!caseSensitive){
																			var propName = prop.name.toLowerCase();
																			detailProperty = detailProperty.toLowerCase();
																		}else{
																			var propName = prop.name;
																			detailProperty = detailProperty;
																		}
																		if( propName == this.decode(detailProperty,true) || propName == this.decode(detailProperty,false)){
																			validDetailObj.property = true;
																			if(!caseSensitive && isNaN(prop.value)){
																				var propValue = prop.value.toLowerCase();
																				if(detailType == "énumération"){
																					detailValue = [];
																					for(var e in detailValueEnum){
																						detailValue.push(detailValueEnum[e].toLowerCase());
																					}
																				}else{
																					detailValue = detailValue.toLowerCase();
																				}
																			}else{
																				var propValue = prop.value;
																				if(detailType == "énumération"){
																					detailValue = detailValueEnum;
																				}else{
																					detailValue = detailValue;
																				}
																			}

																			switch(detailType){ 
																				case "égal à":
																					
																						if(propValue == detailValue || propValue == this.decode(detailValue,true) || propValue == this.decode(detailValue,false)){
																							validDetailObj.value = true;
																						}
																				
																				break;
																				case "superieur à":
																					if(this.isANumber(prop.value) && this.isANumber(detailValue)){ 
																						if(Number(prop.value) > Number(detailValue)){
																							validDetailObj.value = true;
																						}
																					}else{
																						console.log("Superieur à : une des valeurs n'est pas un number (elem)",prop.value,detailValue)
																					}
																					
																				break;
																				case "inferieur à":
																					if(this.isANumber(prop.value) && this.isANumber(detailValue)){ 
																						if(Number(prop.value) < Number(detailValue)){
																							validDetailObj.value = true;
																						}
																					}else{
																						console.log("Inferieur à : une des valeurs n'est pas un number (elem)",prop.value,detailValue)
																					}
																				break;
																				case "contient":
																						propValue = propValue.toString();
																						detailValue = detailValue.toString();
																						if(propValue.indexOf(this.decode(detailValue,true)) != -1 || propValue.indexOf(this.decode(detailValue,false)) != -1){
																							validDetailObj.value = true;
																						}
																					
																				break;
																				case "dans l'intervalle":
																					if(this.isANumber(prop.value) && this.isANumber(detailValue) && this.isANumber(detailValueMax)){
																						if(Number(prop.value) >= Number(detailValue) && Number(prop.value) <= Number(detailValueMax)){
																							validDetailObj.value = true;
																						}
																					}else{
																						console.log("Interval : une des valeurs n'est pas un number (elem) ",prop.value,detailValue,detailValueMax)
																					}
																					
																				break;
																				case "énumération":
																						for(var a in detailValue){
																							if(propValue == detailValue[a] || propValue == this.decode(detailValue[a],true) || propValue == this.decode(detailValue[a],false)){
																								validDetailObj.value = true;
																							}
																						}
																					
																				break;
																				case "pattern":
																						try {
																							propValue = propValue.toString();
																							if(propValue.match(detailValue) || propValue.match(this.decode(detailValue,true)) || propValue.match(this.decode(detailValue,false))){ //attention à vérifier parce que pattern est sensible !!!
																								validDetailObj.value = true;
																							}
																						} catch (error) {
																							console.log("propValue",propValue);
																							console.log("error",error);
																						}
																						
																					

																				break;
																			/* 	case "différent de":
																					if(this.isANumber(detailValue) && this.isANumber(prop.value)){
																						console.log("NUMBER")
																						if(Number(prop.value) != Number(detailValue)){
																							validDetailObj.value = true;
																						}
																					}else{
																						console.log("String")

																						if(propValue != detailValue && propValue != this.decode(detailValue,true) && propValue != this.decode(detailValue,false)){
																							validDetailObj.value = true;
																						}
																					}
																				break;
																				case "ne contient pas":
																					if(propValue.indexOf(this.decode(detailValue,true)) == -1 || propValue.indexOf(this.decode(detailValue,false)) == -1){
																						validDetailObj.value = true;
																					}
																				break; */
																				default:
																					console.log("pas de type attention !! default 'égal à'");
																						if(propValue == detailValue || propValue == this.decode(detailValue,true) || propValue == this.decode(detailValue,false)){
																							validDetailObj.value = true;
																						}
																					
																				break;
																			}
																		}
																	}
																}
															}
														}
													}

													for(var vd in validDetailObj){
														if(validDetailObj[vd] == false){
															allDetailsRespected = false;
															break;
														}
													}
													if(detailCardinality == "Prohibited")
														allDetailsRespected = !allDetailsRespected;
													
													var formattedObj = {};
													formattedObj.id = object.id;
													formattedObj.name = object.name;
													formattedObj.type = object.type;

													if(allDetailsRespected){
														resultErrorObj[v][d].validObjects.push(formattedObj);
													}else{
														isObjAllGood = false;
														resultErrorObj[v][d].errorObjects.push(formattedObj);
														var sceneObj = scene.objects[object.id];
														if(sceneObj && color){
															if(!alreadyColorizedObj)
																sceneObj.colorize = color.split(",");
															else 
																sceneObj.colorize = [1,0,0] 
														}
														alreadyColorizedObj = true;
													}
													
												}
											}
											
										//}
									}
							}
							
							if(isObjAllGood) //faire disparaitre les objets valides pour toutes les verifs
								scene.setObjectsVisible([object.id], false);
							else
								scene.setObjectsVisible([object.id], true);
					}
					console.log("resultErrorObj",resultErrorObj);
					if (document.referrer != ""){
						var stringError = JSON.stringify(resultErrorObj);
						window.parent.postMessage(["resultVerifBim2",resultErrorObj,verifObj,uniqueTestDisplay],document.referrer);
					}
					console.log("validDetailObj",validDetailObj);
					console.timeEnd("verifEachObject")

				break;
				case "displayVerifErrors":
					console.log("displayVerifErrors",e.data[1]);
					var verifObj = e.data[1];
					if(verifObj.color && verifObj.color != undefined)
						var color = this.convertColorFormat(verifObj.color);
					var idsList = [];
					for(var a in verifObj.errorObjects){
						idsList.push(verifObj.errorObjects[a].id);
					}
					console.log("idsList",idsList);
					scene.setObjectsVisible(this.viewer.scene.objectIds, false);
					scene.setObjectsXRayed(idsList,false);
					scene.setObjectsVisible(idsList, true);
					for(var i in idsList){
						var sceneObj = scene.objects[idsList[i]];
						if(sceneObj && color)
							sceneObj.colorize = color.split(",");
					}
				break;
				case "verifEachObject":

					 //attention
					var objects = this.viewer.metaScene.metaObjects;
					var verifObj = e.data[1];
					var resultError = {};
					var objectErrorTab = [];
					var nbSectionError = 0;
					var nbPropError = 0;
					var nbPropValError = 0;
					if(verifObj)
					console.log("verifObj",verifObj);
					if (e.data[3] == "globalVerif"){
						this.bimViewer.resetView();
						var visibleObjects = objects;
					}else{
						scene.setObjectsVisible(scene.xrayedObjectIds, false);
				 		var visibleObjects = scene.visibleObjectIds;
						console.log("typeof visibleObjects",typeof visibleObjects)
					}

					for(var v in verifObj){
						if(v != "allowGreen" && v != "allowColor"){
							var myVerifProp = verifObj[v].property.value;
							var myVerifSection = verifObj[v].section.value;
							resultError[myVerifSection+"-"+myVerifProp] = {};
							resultError[myVerifSection+"-"+myVerifProp].id = myVerifSection+"-"+myVerifProp;
							resultError[myVerifSection+"-"+myVerifProp].objects = {};

							for(var k in visibleObjects){ //parcours chaque objet visible
								if (e.data[3] == "globalVerif"){
									var object = visibleObjects[k];
								}else{
									var object = objects[visibleObjects[k]];
								}

								resultError[myVerifSection+"-"+myVerifProp].objects[object.id] = {};
								resultError[myVerifSection+"-"+myVerifProp].objects[object.id].id = object.id;
								resultError[myVerifSection+"-"+myVerifProp].objects[object.id].name = object.name;
								resultError[myVerifSection+"-"+myVerifProp].objects[object.id].type = object.type;

								var sExist = false; //pourquoi utiliser sExist/pExist ? car lors du parcours des sections certaines sections ne sont forcément pas égale à celle recherchée
								var pExist = false; 

								if(object.propertySets){ 
									var mysections = object.propertySets;
									sExist = false;
									for(var s in mysections){ //parcours ses sections
										if(mysections[s]){
											if(mysections[s].name == this.decode(verifObj[v].section.value,true) || mysections[s].name == this.decode(verifObj[v].section.value,false)){


											/* 	console.log("test section value",this.decode(verifObj[v].section.value,true))
												console.log("object",object); */
												resultError[myVerifSection+"-"+myVerifProp].objects[object.id].section = "OK";
												sExist = true;

												var myprops = mysections[s].properties;
												pExist = false; 
												for(var p in myprops){ //parcours ses propriétés
													
													if(myprops[p].name == this.decode(verifObj[v].property.value,true) || myprops[p].name == this.decode(verifObj[v].property.value,false)){

														resultError[myVerifSection+"-"+myVerifProp].objects[object.id].property = "OK";
														pExist = true;

														var mypropValue = myprops[p].value;
														if(mypropValue == null || mypropValue == undefined || mypropValue === "" || mypropValue.length == 0){
															resultError[myVerifSection+"-"+myVerifProp].objects[object.id].propertyValue = "NOK";
															nbPropValError++;
														}else
															resultError[myVerifSection+"-"+myVerifProp].objects[object.id].propertyValue = "OK";
													}

												}
												if(pExist == false){
													nbPropError++;
													resultError[myVerifSection+"-"+myVerifProp].objects[object.id].property = "NOK";
													resultError[myVerifSection+"-"+myVerifProp].objects[object.id].propertyValue = "NC";
												}else{
													resultError[myVerifSection+"-"+myVerifProp].objects[object.id].property = "OK";
			
												}
											}
										}
										
									}
									//console.log("sExist",sExist)
									if(sExist == false){
										nbSectionError++;
										resultError[myVerifSection+"-"+myVerifProp].objects[object.id].section = "NOK";
										resultError[myVerifSection+"-"+myVerifProp].objects[object.id].property = "NC";
										resultError[myVerifSection+"-"+myVerifProp].objects[object.id].propertyValue = "NC";
									}else{
										resultError[myVerifSection+"-"+myVerifProp].objects[object.id].section = "OK";

									}
								}
							}
					  	}
					}
					var validObjects = [];
					for(var a in resultError){
						for(var b in resultError[a].objects){
							if(resultError[a].objects[b].section == "OK" && resultError[a].objects[b].property == "OK" && resultError[a].objects[b].propertyValue == "OK"){
								validObjects.push(resultError[a].objects[b]);
								delete resultError[a].objects[b];
							}
						}
					}

					var verifLength = [];
					var totalLength = Object.keys(visibleObjects).length;
					for(var a in resultError){
						var mylength = Object.keys(resultError[a].objects).length;
						verifLength.push(mylength);
						resultError[a].errorRate = Math.round((mylength/totalLength*100) * 100) / 100; //pour avoir 2 chiffres après la virgule, on rajoute *100/100
						//resultError[a].errorRateSection = Math.round((nbSectionError/totalLength*100) * 100) / 100;
						//resultError[a].errorRateProperty = Math.round((nbPropError/totalLength*100) * 100) / 100;
						//resultError[a].errorRatePropertyVal = Math.round((nbPropValError/totalLength*100) * 100) / 100; //attention adapter l'absence des property dans modern-dialog 31/05
						resultError[a].totalLength = totalLength;
						
					}
					console.log("resultError",resultError);
					console.log("validObjects",validObjects);

					var errorObjIds = [];
					var validObjIds = [];
					var realObjects = scene.objects;

				
			
					for(var b in validObjects){
						var id = validObjects[b].id;
						validObjIds.push(id);
						if(verifObj.allowGreen){
							for(var o in realObjects){
								if(realObjects[o].id == id){ 
									realObjects[o].colorize = [0,0.8,0.1];
								}
							}
						}
					}	
					for(var a in resultError){
						for(var b in resultError[a].objects){
							var myId = resultError[a].objects[b].id;
							if(errorObjIds.indexOf(myId) == -1)
								errorObjIds.push(myId);
								if(verifObj.allowColor){
									for(var o in realObjects){
										if(realObjects[o].id == myId){ 
											realObjects[o].colorize = [0.9,0,0];
										}
									}
								}
							
						}
					}
				
				
					scene.setObjectsXRayed(this.viewer.scene.objectIds, true);
					scene.setObjectsXRayed(errorObjIds, false);
					
					if(verifObj.allowGreen){ //si allowgreen = false, puis allowgreen = true, les validsObjects ne sont pas visible donc ils sont ignorés plus haut et validObjIds[] est vide
						/* scene.setObjectsVisible(validObjIds, true); */
						scene.setObjectsXRayed(validObjIds, false);
					}
 					if (document.referrer != ""){
						var stringError = JSON.stringify(resultError);
						window.parent.postMessage(["resultVerifBim",stringError],document.referrer);
					}

				break;
				case "displayAnnotation":
					console.time("displayAnnotation")

					this.createFirstAnnotations();
					var jsonTemp = e.data[1];
					if(e.data[3] == "hexa")
						jsonTemp = this.hexToString(jsonTemp);
					this.listAnnotation = JSON.parse(jsonTemp);

					if(e.data[4])
						var ticket = e.data[4];
					
					console.log("this.listAnnotation",this.listAnnotation);
					
						window.nbAnno = 1;

					var listTemp = {};

					for(var a in this.listAnnotation){
						
						var objets = this.listAnnotation[a];
						console.log("annots",objets)
						for(var b in objets){
							listTemp[b] = objets[b];
						}
						

					}
					console.log("listTemp before sort",listTemp);
					var listTab =  Object.entries(listTemp)
					.sort((a, b) => a[0] - b[0])
					.map(([_, valeur]) => valeur);
				console.log("listTemp after sort",listTemp);


						for(var an in listTab){
							var myAnnotation =listTab[an];
							console.log("myAnnotation",myAnnotation);
							console.log("nbAnno",window.nbAnno, myAnnotation.name)
							var nbAnno = window.nbAnno;
							var worldPos = myAnnotation.worldPos.split(",");
							var eye = myAnnotation.eye.split(",");
							var look = myAnnotation.look.split(",");
							var up = myAnnotation.up.split(",");
							var viewurl = myAnnotation.viewurl;
							if(myAnnotation.imgWidth > 380){
								var width = 380;
								var height = 380 / myAnnotation.imgRatio
							}else{
								var width = myAnnotation.imgWidth;
								var height = myAnnotation.imgHeight;
							}
							if(!width || !height){
								console.log("width or height not defined => default size used");
								width = 420;
								height = 300;
							}

							var color =  myAnnotation.color ? myAnnotation.color : "grey";

							try {
								if(!viewurl){
									var annotation = window.annotations.createAnnotation({
										id: nbAnno,
										worldPos: worldPos,// <<------- initializes worldPos and entity from PickResult
										occludable: false,       // Optional, default is true
										markerShown: true,      // Optional, default is true
										labelShown: false,	// Optional, default is true
										eye: eye,  
										look: look,
										up: up,      
										values: {               // HTML template values
											glyph: "A" + nbAnno,
											title: myAnnotation.name,
											description: myAnnotation.description,
											markerBGColor: color,
										},
									});
								}else{
									var annotation = window.annotations.createAnnotation({
										id: nbAnno,
										worldPos: worldPos,// <<------- initializes worldPos and entity from PickResult
										occludable: false,       // Optional, default is true
										markerShown: true,      // Optional, default is true
										labelShown: false,	// Optional, default is true
										eye: eye,  
										look: look,
										up: up, 													//width:500px !important;
										labelHTML: "<div class='annotation-label' style='background-color: {{labelBGColor}};'>\
										<div class='annotation-title' style='text-align:center;font-weight:bold;'>{{title}}</div>\
										<div class='annotation-desc' style='font-style:italic;padding-left:10px;'>{{description}}</div>\
										<br><img style='border-radius:8px;' alt='myImage' width='"+width+"' height='"+height+"' src=\"{{imageSrc}}\">\
										</div>",      
										values: {               // HTML template values
											glyph: "A" + nbAnno,
											title: myAnnotation.name,
											description: myAnnotation.description,
											markerBGColor: color,
											imageSrc: viewurl + "?alf_ticket=" + ticket,
										},
									});
							}
								window.nbAnno++;
							} catch (error) {
								console.log("error Annotation",error);
								//window.nbAnno--; ???
							}

						} 
					
					//this.addEventMouseUpDownForMarker();
					window.toolbarElem.querySelector(".xeokit-enableAnnotations").style.display = "block";
					console.timeEnd("displayAnnotation")
					/* console.time("displayAnnotation")

					this.createFirstAnnotations();
					var jsonTemp = e.data[1];
					if(e.data[3] == "hexa")
						jsonTemp = this.hexToString(jsonTemp);
					this.listAnnotation = JSON.parse(jsonTemp);

					if(e.data[4])
						var ticket = e.data[4];
					
					console.log("this.listAnnotation",this.listAnnotation);
					
					if(!window.nbAnno || window.nbAnno == "undefined" || window.nbAnno == undefined)
						window.nbAnno = 1;

					for(var a in this.listAnnotation){
						
						var objets = this.listAnnotation[a];
						this.listAnnotation[a] = Object.keys(objets).sort(function(a, b) {
							return a - b; // Comparaison des timestamps
						}).reduce(function(result, key) {
							result[key] = objets[key];
							return result;
						}, {});


						for(var b in this.listAnnotation[a]){
							var myAnnotation = this.listAnnotation[a][b];
							console.log("myAnnotation",myAnnotation);
							var nbAnno = window.nbAnno;//Number(myAnnotation.nbAnno);
							var worldPos = myAnnotation.worldPos.split(",");
							var eye = myAnnotation.eye.split(",");
							var look = myAnnotation.look.split(",");
							var up = myAnnotation.up.split(",");
							var viewurl = myAnnotation.viewurl;
							if(myAnnotation.imgWidth > 380){
								var width = 380;
								var height = 380 / myAnnotation.imgRatio
							}else{
								var width = myAnnotation.imgWidth;
								var height = myAnnotation.imgHeight;
							}
							if(!width || !height){
								console.log("width or height not defined => default size used");
								width = 420;
								height = 300;
							}

							var color =  myAnnotation.color ? myAnnotation.color : "grey";

							try {
								if(!viewurl){
									var annotation = window.annotations.createAnnotation({
										id: nbAnno,
										worldPos: worldPos,// <<------- initializes worldPos and entity from PickResult
										occludable: false,       // Optional, default is true
										markerShown: true,      // Optional, default is true
										labelShown: false,	// Optional, default is true
										eye: eye,  
										look: look,
										up: up,      
										values: {               // HTML template values
											glyph: "A" + nbAnno,
											title: myAnnotation.name,
											description: myAnnotation.description,
											markerBGColor: color,
										},
									});
								}else{
									var annotation = window.annotations.createAnnotation({
										id: nbAnno,
										worldPos: worldPos,// <<------- initializes worldPos and entity from PickResult
										occludable: false,       // Optional, default is true
										markerShown: true,      // Optional, default is true
										labelShown: false,	// Optional, default is true
										eye: eye,  
										look: look,
										up: up, 													//width:500px !important;
										labelHTML: "<div class='annotation-label' style='background-color: {{labelBGColor}};'>\
										<div class='annotation-title' style='text-align:center;font-weight:bold;'>{{title}}</div>\
										<div class='annotation-desc' style='font-style:italic;padding-left:10px;'>{{description}}</div>\
										<br><img style='border-radius:8px;' alt='myImage' width='"+width+"' height='"+height+"' src=\"{{imageSrc}}\">\
										</div>",      
										values: {               // HTML template values
											glyph: "A" + nbAnno,
											title: myAnnotation.name,
											description: myAnnotation.description,
											markerBGColor: color,
											imageSrc: viewurl + "?alf_ticket=" + ticket,
										},
									});
							}
								window.nbAnno++;
							} catch (error) {
								console.log("error Annotation",error);
								//window.nbAnno--; ???
							}

						} 
					}
					//this.addEventMouseUpDownForMarker();
					window.toolbarElem.querySelector(".xeokit-enableAnnotations").style.display = "block";
					console.timeEnd("displayAnnotation") */

				break;
				case "flyToAnnot":
					console.log("flyToAnnot",e.data[1]);
					var id = e.data[1];
					console.log("annotations",window.annotations);
					var annotation = window.annotations.annotations[id];
					console.log("annotation",annotation);
					this.viewer.cameraFlight.flyTo(annotation);

					//postMessage(action,data)
				break;
				case "flyToQRCode":
					console.log("flyToQRCode",e.data[1]);
					var ids = e.data[1];
					scene.setObjectsVisible(this.viewer.scene.objectIds,false);
					var idsTab = [];
					idsTab = ids.split(",");
					scene.setObjectsVisible(idsTab,true);
					this.bimViewer.viewFitObjects(idsTab);
				break;
				case "flyToClash":
					console.log("flyToClash",e.data[1]);
					var ids = e.data[1];
					var showXrayed = e.data[3];
					scene.setObjectsVisible(this.viewer.scene.objectIds,false);

					if(showXrayed){
						scene.setObjectsVisible(this.viewer.scene.objectIds,true);
						scene.setObjectsXRayed(this.viewer.scene.objectIds,true);
					}else{
						scene.setObjectsVisible(this.viewer.scene.objectIds,false);
						scene.setObjectsXRayed(this.viewer.scene.objectIds,false);
					}
					var idsTab = [];
					idsTab = ids.split(",");
					var obj1 = scene.objects[idsTab[0]];
					var obj2 = scene.objects[idsTab[1]];
					obj1.colorize = [0.8,0,0];
					obj2.colorize = [0,0,0.8];
					scene.setObjectsVisible(idsTab,true);
					scene.setObjectsXRayed(idsTab,false);
					this.bimViewer.viewFitObjects(idsTab);
				break;
				case "flyToDiff":
					console.log("flyToDiff",e.data[1]);
					var ids = e.data[1];
					var showXrayed = e.data[3];
					if(showXrayed){
						scene.setObjectsVisible(this.viewer.scene.objectIds,true);
						scene.setObjectsXRayed(this.viewer.scene.objectIds,true);
					}else{
						scene.setObjectsVisible(this.viewer.scene.objectIds,false);
						scene.setObjectsXRayed(this.viewer.scene.objectIds,false);
					}
					var idsTab = [];
					idsTab = ids.split(",");
					
					scene.setObjectsVisible(idsTab,true);
					scene.setObjectsXRayed(idsTab,false);
					this.bimViewer.viewFitObjects(idsTab);
				break;
				case "updateAnnotation":
					console.log("updateAnnotation",e.data[1]);
					jsonTemp = e.data[1];
					if(e.data[3] == "hexa"){
						jsonTemp = this.hexToString(jsonTemp);
						jsonTemp = JSON.parse(jsonTemp);
					}
					var myAnnotation = jsonTemp.annot;

					if(myAnnotation.mytype == "addAnnotation")
						var id = myAnnotation.nbAnno;
					else
						var id = jsonTemp.nbAnno;
					var annotation = window.annotations.annotations[id];
					annotation.destroy();
					if(typeof myAnnotation.worldPos == "string")
						var worldPos = myAnnotation.worldPos.split(",");
					else
						var worldPos = myAnnotation.worldPos;
					
					if(typeof myAnnotation.eye == "string")
						var eye = myAnnotation.eye.split(",");
					else
						var eye = myAnnotation.eye;

					if(typeof myAnnotation.look == "string")
						var look = myAnnotation.look.split(",");
					else
						var look = myAnnotation.look;

					if(typeof myAnnotation.up == "string")
						var up = myAnnotation.up.split(",");
					else
						var up = myAnnotation.up;

					var color = myAnnotation.color;
					if(myAnnotation.viewurl && myAnnotation.ticket){
						var viewurl = myAnnotation.viewurl;
						var ticket = myAnnotation.ticket;
					}
					//alert(myAnnotation.color);
					if(!viewurl){
						var NewAnnotation = window.annotations.createAnnotation({
							id: id,
							worldPos : worldPos,// <<------- initializes worldPos and entity from PickResult
							occludable: false,       // Optional, default is true
							markerShown: true,      // Optional, default is true
							labelShown: false,	// Optional, default is true
							eye:eye,  
							look:look,
							up:up,      
							values: {               // HTML template values
								glyph: "A" + id,
								title: myAnnotation.name,
								description: myAnnotation.description,
								markerBGColor: color,
							},
						});
					}else{
						if(myAnnotation.imgWidth > 380){
							var width = 380;
							var height = 380 / myAnnotation.imgRatio
						}else{
							var width = myAnnotation.imgWidth;
							var height = myAnnotation.imgHeight;
						}

						if(!width || !height){
							console.log("width or height not defined => default size used");
							width = 420;
							height = 300;
						}

						var NewAnnotation = window.annotations.createAnnotation({
							id: id,
							worldPos : worldPos,// <<------- initializes worldPos and entity from PickResult
							occludable: false,       // Optional, default is true
							markerShown: true,      // Optional, default is true
							labelShown: false,	// Optional, default is true
							eye:eye,  
							look:look,
							up:up,  														//width:430px !important;
							labelHTML: "<div class='annotation-label' style='background-color: {{labelBGColor}};'>\
										<div class='annotation-title' style='text-align:center;font-weight:bold;'>{{title}}</div>\
										<div class='annotation-desc' style='font-style:italic;padding-left:10px;'>{{description}}</div>\
										<br><img style='border-radius:8px;' alt='myImage' width='"+width+"' height='"+height+"' src=\"{{imageSrc}}\">\
										</div>",    
							values: {               // HTML template values
								glyph: "A" + id,
								title: myAnnotation.name,
								description: myAnnotation.description,
								markerBGColor: color,
								imageSrc: viewurl + "?alf_ticket=" + ticket,
							},
						});
					}
					console.log("annotations",window.annotations);
					
				break;
				case "resetAnnotations":
					if(window.annotations){
						window.annotations.destroy();
						window.nbAnno = 1	
					}		
					window.toolbarElem.querySelector(".xeokit-enableAnnotations").style.backgroundColor = "#0061A7";
					//window.toolbarElem.querySelector(".xeokit-enableAnnotations").style.display = "none";
					this.isAnnotationsEnabled = false;
				break;
				case "getVisibleObjects":
					var xrayedObject = scene.xrayedObjectIds;
					scene.setObjectsVisible(xrayedObject, false);
					var visibleObjects = scene.visibleObjectIds;
					var objects = this.viewer.metaScene.metaObjects;
					console.log("objects",objects);
					var ifcTypes = [];
					for(var a in visibleObjects){
						var object = objects[visibleObjects[a]];
						if(object.type){
							ifcTypes.push(object.type);
						}
					}
					
					var QRCViewpoints = new BCFViewpointsPlugin(this.viewer);
					var QRCviewpoint = QRCViewpoints.getViewpoint({ // Options
						spacesVisible: false, // Don't force IfcSpace types visible in viewpoint (default)
						spaceBoundariesVisible: false, // Don't show IfcSpace boundaries in viewpoint (default)
						openingsVisible: false // Don't force IfcOpening types visible in viewpoint (default)
					});
					
					var QRCviewpointStr = JSON.stringify(QRCviewpoint, null, 4);
					var result = {};
					result.visibleObjects = visibleObjects;
					result.ifcTypes = ifcTypes;
					result.viewpoint = QRCviewpointStr;
					
					if (document.referrer != ""){
						if(!e.data[1] || e.data[1] == null)
						window.parent.postMessage(["resultGetVisibleObjects",result], document.referrer);
						if(e.data[1] == "generateQRCode")
						window.parent.postMessage(["resultGenerateQRCode",result], document.referrer);
					}
				break;
				/* case  "generateQRCode":
					var xrayedObject = scene.xrayedObjectIds;
					scene.setObjectsVisible(xrayedObject, false);
					var visibleObjects = scene.visibleObjectIds;
					var objects = this.viewer.metaScene.metaObjects;
					console.log("objects",objects);
					var ifcTypes = [];
					for(var a in visibleObjects){
						var object = objects[visibleObjects[a]];
						if(object.type){
							ifcTypes.push(object.type);
						}
					}
					

					var result = {};
					result.visibleObjects = visibleObjects;
					result.ifcTypes = ifcTypes;

					
					if (document.referrer != "")
					window.parent.postMessage(["resultGenerateQRCode",result], document.referrer);

				break; */
				case "testCapteurs":
					var data = e.data[1].niveaux;
					var metaStoreys = this.viewer.metaScene.metaObjectsByType.IfcBuildingStorey;
					scene.setObjectsVisible(this.viewer.scene.objectIds,true);
					scene.setObjectsXRayed(this.viewer.scene.objectIds,true);
					console.log("metaStoreys",metaStoreys);
					var idsTab = [];

					for(var m in metaStoreys){
						if(data[m] && data[m].isFire == "true"){
							if(metaStoreys[m].children){
								for(var c in metaStoreys[m].children){
									idsTab.push(metaStoreys[m].children[c].id);
									
								}
							}
						}
					}
					for(var i in idsTab){
						var obj = scene.objects[idsTab[i]];
						if(obj){
							obj.colorize = [0.8,0,0];
						}
					}
					console.log("test Capteurs ids",idsTab)
					scene.setObjectsXRayed(idsTab,false);
					//this.bimViewer.viewFitObjects(idsTab);
					/* var random = e.data[1];
					var niveau = "";
					switch (random) {
						case 0:
							niveau = "BAT B RDC";
						break;
						case 1:
							niveau = "BAT B R+1";
						break;
						case 2:
							niveau = "BAT B R+2";
						break;
						case 3:
							niveau = "BAT B R+3";
						break;
						case 4:
							niveau = "BAT B R+4";
						break;
						case 5:
							niveau = "BAT A RDC";
						break;
						case 6:
							niveau = "BAT A-B R-1";
						break;
						case 7:
							niveau = " BAT A R+2";
						break;
						case 8:
							niveau = " BAT A R+4";
						break;
						case 9:
							niveau = " BAT A R+3";
						break;
						case 10:
							niveau = "BAT A TOITURE";
						break;
						default:
							break;
					}
					this.capteursDemo(niveau); */

				break;
				case "getMetaModels":
					var viewer = this.viewer;
					if(viewer && viewer.metaScene && viewer.metaScene._modelIds)
						var metaModels = viewer.metaScene._modelIds;
					if(viewer && viewer.metaScene && viewer.metaScene.viewer && viewer.metaScene.viewer.scene._modelIds)
						var metaModels = viewer.metaScene._modelIds;
					console.log("metaModels",metaModels);

				break;
				
				case "showDiffResult":
					console.log("models",scene.models)
					console.log("scene",scene);
					console.log("viewer.scene",this.viewer.scene)

					var diffResult = JSON.parse(e.data[1][0]);
					var modelToDisplay = JSON.parse(e.data[1][1])
					console.log("modelToDisplay",modelToDisplay);
					var chosenModel;
					if(modelToDisplay){
						for(var a in scene.models){
							if(scene.models[a].id != modelToDisplay.id){
								var model = scene.models[a];
								model.visible = false;
								console.log("model hidden",model.id)
							}else{
								var model = scene.models[a];
								model.visible = true;
								chosenModel = model;
								console.log("model visible",model.id)
							}
						}
						console.log("choosen model",chosenModel);

					}
					//const model = scene.models[modelId];
					var currentModelScene = chosenModel.scene;
					console.log("diffResult",diffResult);

					currentModelScene.setObjectsVisible(currentModelScene.objectIds,true);
					currentModelScene.setObjectsXRayed(currentModelScene.objectIds,true);
					var idsToShow = [];
					for(var a in diffResult){
						var id =  diffResult[a].id;
						idsToShow.push(id);
						var sceneObj = currentModelScene.objects[id];
						if(sceneObj){
							if(diffResult[a].type == "Ajout"){
								sceneObj.colorize = [0,0.8,0];
							}else if(diffResult[a].type == "Suppression"){
								sceneObj.colorize = [0.8,0,0];
							}else if(diffResult[a].type == "Modification"){
								sceneObj.colorize = [0.92,0.34,0];
							}
						}else{
							console.log("sceneObj manquand")
						}	
					}
				
					//afficher le new avant
					currentModelScene.setObjectsXRayed(idsToShow,false);
					
					//scene.setObjectsVisible(this.viewer.scene.objectIds,false);
				break;
				case "colorizeCityJSON":
					
					var objects = scene.objects;
					var cityJSONData = JSON.parse(e.data[1]);
					console.log("colorizeCityJSON",cityJSONData);
					window.cityJSONData = cityJSONData;
					window.hasToColorizeCity = true;
					for(var a in objects){
						for(var b in cityJSONData){
							if(cityJSONData[b].batId == objects[a].id){
								console.log("bat trouvé !",objects[a].id);
								objects[a].colorize = [0,0.38,0.65]
							}
						}
					}
					console.log("endCOlorize")
					this.showToast('Double cliquez sur un bâtiment lié pour afficher l\'IFC correspondant.', 4000);

				break;
				case "flyToObject":
					var objTabIds = e.data[1].ids;
					console.log("flyToObjet",this.viewer.scene.objects);
					this.bimViewer.viewFitObjects(objTabIds);
					scene.setObjectsVisible(this.viewer.scene.objectIds, true);
					

				break;
				default:
					console.log("default setQuery")
				break;
				/* case "initConfViewer":
					this.initConfViewer();
				break; */
					/* var filterObject = e.data[1]; 
					var allObjects = this.viewer.metaScene.metaObjects;
					
					// --- Pré-calculs pour le traitement général ---
					var batSectionTrue   = this.decode(filterObject.bat.section, true);
					var batSectionFalse  = this.decode(filterObject.bat.section, false);
					var batPropertyTrue  = this.decode(filterObject.bat.property, true);
					var batPropertyFalse = this.decode(filterObject.bat.property, false);
					
					var niveauSectionTrue   = this.decode(filterObject.niveau.section, true);
					var niveauSectionFalse  = this.decode(filterObject.niveau.section, false);
					var niveauPropertyTrue  = this.decode(filterObject.niveau.property, true);
					var niveauPropertyFalse = this.decode(filterObject.niveau.property, false);
					
					var codeSectionTrue   = this.decode(filterObject.code.section, true);
					var codeSectionFalse  = this.decode(filterObject.code.section, false);
					var codePropertyUpper = this.decode(filterObject.code.property, true).toUpperCase();
					
					// Pour "custom"
					var customDecoded = {};
					for (var cu in filterObject.custom) {
						customDecoded[cu] = {
							sectionTrue:  this.decode(filterObject.custom[cu].section.value, true),
							sectionFalse: this.decode(filterObject.custom[cu].section.value, false),
							propertyTrue: this.decode(filterObject.custom[cu].property.value, true).toUpperCase(),
							propertyFalse: this.decode(filterObject.custom[cu].property.value, false).toUpperCase()
						};
					}
					
					// --- Pré-calculs pour le traitement détaillé (calcul area et volume) ---
					var calculSection           = this.decode(filterObject.calcul.section, true);
					var calculPropertyAreaTrue  = this.decode(filterObject.calcul.propertyArea, true).toUpperCase();
					var calculPropertyAreaFalse = this.decode(filterObject.calcul.propertyArea, false).toUpperCase();
					var calculPropertyVolumeTrue  = this.decode(filterObject.calcul.propertyVolume, true).toUpperCase();
					var calculPropertyVolumeFalse = this.decode(filterObject.calcul.propertyVolume, false).toUpperCase();
					
					// Initialisation des résultats pour le traitement général
					var resultGeneral = {
						bat:    {},
						niveau: {},
						code:   {},
						custom: {}
					};
					
					// Pour chaque valeur, on stocke un tableau des IDs d'objets correspondants
					var resultGeneralObjects = {
						custom: {}
					};
					
					// Initialisation des résultats détaillés
					var resultDetail = { sections: {} };
					var classIFCTab  = [];
					var classIfCData = {};
					
					// Boucle unique sur tous les objets
					for (var k in allObjects) {
						var object = allObjects[k];
						var propertySets = object.propertySets;
						if (!propertySets) continue;
					
						// Variables pour le traitement détaillé de cet objet
						var oVolume = 0, oArea = 0;
						var bat = null, niveau = null, code = "classBim"; // valeur par défaut
					
						// Si le filtre demande "classBim" pour bat ou niveau, monter dans la hiérarchie
						if (filterObject.bat.property === "classBim" || filterObject.niveau.property === "classBim") {
							var parentTemp = object;
							while (!bat && parentTemp) {
								if (parentTemp.type === "IfcBuilding") {
									bat = parentTemp.name;
								}
								if (parentTemp.type === "IfcBuildingStorey") {
									niveau = parentTemp.name;
								}
								parentTemp = parentTemp.parent;
							}
						}
					
						// Parcours de tous les propertySets de l'objet
						for (var i in propertySets) {
							var propertySet = propertySets[i];
							if (!propertySet) continue;
					
							// --- Traitement général ---
					
							// Traitement pour "bat"
							if (filterObject.bat.property !== "classBim") {
								if (propertySet.name === batSectionTrue || propertySet.name === batSectionFalse) {
									var props = propertySet.properties;
									for (var c in props) {
										var prop = props[c];
										if (prop.name === batPropertyTrue || prop.name === batPropertyFalse) {
											var val = this.decode(prop.value);
											resultGeneral.bat[val] = (resultGeneral.bat[val] || 0) + 1;
											
										}
									}
								}
							} else {
								// Pour "classBim", si l'objet est un IfcBuilding, le traiter directement
								if (object.type === "IfcBuilding") {
									var bName = this.decode(object.name);
									var count = 0;
									if (object.metaModels) {
										for (var m in object.metaModels) {
											var metaObjs = object.metaModels[m].metaObjects;
											count += metaObjs ? metaObjs.length : 0;
										}
									}
									resultGeneral.bat[bName] = count;
									
								}
							}
					
							// Traitement pour "niveau"
							if (filterObject.niveau.property !== "classBim") {
								if (propertySet.name === niveauSectionTrue || propertySet.name === niveauSectionFalse) {
									var props = propertySet.properties;
									for (var c in props) {
										var prop = props[c];
										if (prop.name === niveauPropertyTrue || prop.name === niveauPropertyFalse) {
											var val = this.decode(prop.value, true);
											resultGeneral.niveau[val] = (resultGeneral.niveau[val] || 0) + 1;
											
										}
									}
								}
							} else {
								if (object.type === "IfcBuildingStorey") {
									var sName = this.decode(object.name);
									resultGeneral.niveau[sName] = object.children ? object.children.length : 0;
									
								}
							}
					
							// Traitement pour "code"
							if (propertySet.name === codeSectionTrue || propertySet.name === codeSectionFalse) {
								var props = propertySet.properties;
								for (var c in props) {
									var prop = props[c];
									if (this.decode(prop.name).toUpperCase() === codePropertyUpper) {
										var val = this.decode(prop.value);
										resultGeneral.code[val] = (resultGeneral.code[val] || 0) + 1;
									}
								}
							}
					
							// Traitement pour "custom"
							for (var cu in filterObject.custom) {
								if (propertySet.name === customDecoded[cu].sectionTrue || propertySet.name === customDecoded[cu].sectionFalse) {
									var props = propertySet.properties;
									for (var c in props) {
										var prop = props[c];
										var propNameUpper = this.decode(prop.name).toUpperCase();
										if (propNameUpper === customDecoded[cu].propertyTrue || propNameUpper === customDecoded[cu].propertyFalse) {
											var val = this.decode(prop.value);
											if (!resultGeneral.custom[cu]) resultGeneral.custom[cu] = {};
											resultGeneral.custom[cu][val] = (resultGeneral.custom[cu][val] || 0) + 1;
											
											if (!resultGeneralObjects.custom[cu]) {
												resultGeneralObjects.custom[cu] = {};
											}
											if (!resultGeneralObjects.custom[cu][val]) {
												resultGeneralObjects.custom[cu][val] = [];
											}
											resultGeneralObjects.custom[cu][val].push(object.id);
										}
									}
								}
							}
					
							// --- Traitement détaillé (sections, calcul area/volume) ---
					
							// Récupération ou création de la section dans resultDetail
							var sectionName = this.decode(propertySet.name);
							if (!resultDetail.sections[sectionName]) {
								resultDetail.sections[sectionName] = { properties: {} };
							}
							// Stockage d'informations complémentaires par type et section
							if (!classIfCData[object.type])
								classIfCData[object.type] = {};
							if (classIFCTab.indexOf(object.type) === -1)
								classIFCTab.push(object.type);
							if (!classIfCData[object.type][sectionName])
								classIfCData[object.type][sectionName] = [];
							var props = propertySet.properties;
							for (var c in props) {
								var propName = this.decode(props[c].name);
								if (classIfCData[object.type][sectionName].indexOf(propName) === -1)
									classIfCData[object.type][sectionName].push(propName);
								if (!resultDetail.sections[sectionName].properties[propName]) {
									resultDetail.sections[sectionName].properties[propName] = {};
								}
								// Si c'est la section de calcul, récupérer area et volume
								if (propertySet.name === calculSection) {
									if (props[c].name.toUpperCase() === calculPropertyAreaTrue || props[c].name.toUpperCase() === calculPropertyAreaFalse) {
										oArea = Number(props[c].value);
									}
									if (props[c].name.toUpperCase() === calculPropertyVolumeTrue || props[c].name.toUpperCase() === calculPropertyVolumeFalse) {
										oVolume = Number(props[c].value);
									}
								}
							}
							// Recherche d'informations bat, niveau et code dans les propertySets
							if (propertySet.name === this.decode(filterObject.bat.section, true) ||
								propertySet.name === this.decode(filterObject.bat.section, false)) {
								var props = propertySet.properties;
								for (var c in props) {
									if (props[c].name.toUpperCase() === this.decode(filterObject.bat.property, true).toUpperCase() ||
										props[c].name.toUpperCase() === this.decode(filterObject.bat.property, false).toUpperCase()) {
										bat = props[c].value;
									}
								}
							}
							if (propertySet.name === this.decode(filterObject.niveau.section, true) ||
								propertySet.name === this.decode(filterObject.niveau.section, false)) {
								var props = propertySet.properties;
								for (var c in props) {
									if (props[c].name.toUpperCase() === this.decode(filterObject.niveau.property, true).toUpperCase() ||
										props[c].name.toUpperCase() === this.decode(filterObject.niveau.property, false).toUpperCase()) {
										niveau = props[c].value;
									}
								}
							}
							if (propertySet.name === this.decode(filterObject.code.section, true) ||
								propertySet.name === this.decode(filterObject.code.section, false)) {
								var props = propertySet.properties;
								for (var c in props) {
									if (props[c].name.toUpperCase() === this.decode(filterObject.code.property, true).toUpperCase() ||
										props[c].name.toUpperCase() === this.decode(filterObject.code.property, false).toUpperCase()) {
										code = props[c].value;
									}
								}
							}
						} // Fin du parcours des propertySets
					
						// Agrégation détaillée par bat / niveau / code
						if (bat) {
							if (!resultDetail[bat])
								resultDetail[bat] = {};
							if (niveau) {
								if (!resultDetail[bat][niveau])
									resultDetail[bat][niveau] = {};
								if (code) {
									if (!resultDetail[bat][niveau][code]) {
										resultDetail[bat][niveau][code] = { count: 0, area: 0, volume: 0, objects: {} };
									}
									resultDetail[bat][niveau][code].objects[object.id] = {
										guid: object.id,
										name: object.name,
										area: oArea,
										volume: oVolume
									};
									resultDetail[bat][niveau][code].area   += oArea;
									resultDetail[bat][niveau][code].volume += oVolume;
									resultDetail[bat][niveau][code].count++;
								}
							}
						}
					} // Fin de la boucle sur tous les objets
					
					var mergedResult = {
						generalProperties: resultGeneral,
						generalPropertiesObjects: resultGeneralObjects,
						detailedSections: resultDetail,
						classIFCTypes: classIFCTab,
						classIFCData: classIfCData
					};
					console.log("mergedResult", mergedResult); */
		}

	
		}
}

export {Controller};