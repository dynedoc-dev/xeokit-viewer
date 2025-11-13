import {utils} from "@xeokit/xeokit-sdk/dist/xeokit-sdk.es.js";

/**
 * Default server client which loads content for a {@link BIMViewer} via HTTP from the file system.
 *
 * A BIMViewer is instantiated with an instance of this class.
 *
 * To load content from an alternative source, instantiate BIMViewer with your own custom implementation of this class.
 */
class Server {

    /**
     * Constructs a Server.
     *
     * @param {*} [cfg] Server configuration.
     * @param {String} [cfg.dataDir] Base directory for content.
     */
    constructor(cfg = {}) {
        this._dataDir = cfg.dataDir || "";
		this._bimIds = cfg.bimIds || "design";
		this._token = cfg.token;
    }

    /**
     * Gets information on all available projects.
     *
     * @param {Function} done Callback through which the JSON result is returned.
     * @param {Function} error Callback through which an error message is returned on error.
     */
    getProjects(done, error) {
        const url = this._dataDir + "/projects/index.json";
        utils.loadJSON(url, done, error);
    }

    /**
     * Gets information for a project.
     *
     * @param {String} projectId ID of the project.
     * @param {Function} done Callback through which the JSON result is returned.
     * @param {Function} error Callback through which an error message is returned on error.
     */
    getProject(projectId, done, error) {
       // const url = this._dataDir + "/projects/" + projectId + "/index.json?v="+new Date().getTime();
		const originalBimIds = this._bimIds.split(",");
		var  bimIds = new Object();
		for (let j = 0; j < originalBimIds.length; j++) {
			var temp = originalBimIds[j].split(";");
			var bimId = temp[0];
			var token = temp[1];
			var tokenP = temp[2] ? temp[2] : "none";
			bimIds[bimId] = token;
		}
		this._bimIds = bimIds;
		var pushedIds = [];
		var newModels = [];
		var url = window.location.href.split("/app/")[0].replace("http://","http://"+tokenP+"@").replace("https://","https://"+tokenP+"@")+"/app/data" + "/projects/" + projectId + "/index.json"+"?v="+new Date().getTime();
		url = url.replace("githubBim2","");
		url = url.replace("githubBim","bim");
		url = url.replace("bimTest","bim");
		url = url.replace("bim24","");
		console.log("tokenP",url);
        utils.loadJSON(url, function (projectInfo) { 
		const modelsInfo = projectInfo.models || [];
            for (let i = 0; i < modelsInfo.length; i++) {
				const modelInfo = modelsInfo[i];
				if (bimIds[modelInfo.id])
				{
				newModels.push(modelInfo);
				pushedIds.push(modelInfo.id);
				}
			}
		var notFoundedIds = "";
		for (let j in bimIds) {
			if (pushedIds.indexOf(j) == -1)
				{
				 if (notFoundedIds != "")
					 notFoundedIds += ",";
				 notFoundedIds += j;
				}
		}
		projectInfo.models = newModels;
		done(projectInfo);
		console.log("newMODELE",projectInfo);
        
		 if (document.referrer != "" && notFoundedIds != "")
			window.parent.postMessage(["noModel",notFoundedIds], document.referrer); 
		
		}, 
		
		error);
    }

    /**
     * Gets metadata for a model within a project.
     *
     * @param {String} projectId ID of the project.
     * @param {String} modelId ID of the model.
     * @param {Function} done Callback through which the JSON result is returned.
     * @param {Function} error Callback through which an error message is returned on error.
     */
    getMetadata(projectId, modelId, done, error) {
        const url = this._dataDir + "/projects/" + projectId + "/models/" + modelId + "/metadata.json";
        utils.loadJSON(url, done, error);
    }

    /**
     * Gets geometry for a model within a project.
     *
     * @param {String} projectId ID of the project.
     * @param {String} modelId ID of the model.
     * @param {Function} done Callback through which the JSON result is returned.
     * @param {Function} error Callback through which an error message is returned on error.
     */
    getGeometry(projectId, modelId, done, error) {
        //const url = this._dataDir + "/projects/" + projectId + "/models/" + modelId + "/geometry.xkt";
		var url = window.location.href.split("/app/")[0].replace("http://","http://"+this._bimIds[modelId]+"@").replace("https://","https://"+this._bimIds[modelId]+"@")+"/app/data" + "/projects/" + projectId + "/models/" + modelId + "/geometry.xkt"+"?v="+new Date().getTime();
		url = url.replace("githubBim2","");
		url = url.replace("githubBim","bim");
		url = url.replace("bimTest","bim");
		url = url.replace("bim24","");
		console.log("token",url);
		
        utils.loadArraybuffer(url, done, error);
    }

    /**
     * Gets metadata for an object within a model within a project.
     *
     * @param {String} projectId ID of the project.
     * @param {String} modelId ID of the model.
     * @param {String} objectId ID of the object.
     * @param {Function} done Callback through which the JSON result is returned.
     * @param {Function} error Callback through which an error message is returned on error.
     */
    getObjectInfo(projectId, modelId, objectId, done, error) {
        const url = this._dataDir + "/projects/" + projectId + "/models/" + modelId + "/props/" + objectId + ".json";
        utils.loadJSON(url, done, error);
    }

    /**
     * Gets existing issues for a model within a project.
     *
     * @param {String} projectId ID of the project.
     * @param {String} modelId ID of the model.
     * @param {Function} done Callback through which the JSON result is returned.
     * @param {Function} error Callback through which an error message is returned on error.
     */
    getIssues(projectId, modelId, done, error) {
        const url = this._dataDir + "/projects/" + projectId + "/models/" + modelId + "/issues.json";
        utils.loadJSON(url, done, error);
    }


    /**
     * Gets a JSON manifest file for a model that's split into multiple XKT files (and maybe also JSON metadata files).
     *
     * The manifest can have an arbitrary name, and will list all the XKT (and maybe separate JSON metada files)
     * that comprise the model.
     *
     * @param {String} projectId ID of the project.
     * @param {String} modelId ID of the model.
     * @param {String} manifestName Filename of the manifest.
     * @param {Function} done Callback through which the JSON result is returned.
     * @param {Function} error Callback through which an error message is returned on error.
     */
    getSplitModelManifest(projectId, modelId, manifestName, done, error) {
        const url = this._dataDir + "/projects/" + projectId + "/models/" + modelId + "/" + manifestName;
        utils.loadJSON(url, done, error);
    }

    /**
     * Gets one of the metadata files within a split model within a project.
     *
     * @param {String} projectId ID of the project.
     * @param {String} modelId ID of the model.
     * @param {String} metadataFileName Filename of the metadata file.
     * @param {Function} done Callback through which the JSON result is returned.
     * @param {Function} error Callback through which an error message is returned on error.
     */
    getSplitModelMetadata(projectId, modelId, metadataFileName, done, error) {
        const url = this._dataDir + "/projects/" + projectId + "/models/" + modelId + "/" + metadataFileName;
        utils.loadJSON(url, done, error);
    }

    /**
     * Gets one of the XKT geometry files within a split model within a project.
     *
     * @param {String} projectId ID of the project.
     * @param {String} modelId ID of the model.
     *  @param {String} geometryFileName Filename of the XKT geometry file.
     * @param {Function} done Callback through which the JSON result is returned.
     * @param {Function} error Callback through which an error message is returned on error.
     */
    getSplitModelGeometry(projectId, modelId, geometryFileName, done, error) {
        const url = this._dataDir + "/projects/" + projectId + "/models/" + modelId + "/" + geometryFileName;
        utils.loadArraybuffer(url, done, error);
    }
}

export {Server};