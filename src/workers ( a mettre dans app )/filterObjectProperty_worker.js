function escapeRegExp(string) {
    return string.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, "\\$1");
}

function decode(str,encode ) { //mettre une condition à décode : vérifier que la chaine est encodée avant de décode !

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
			str = str.replace(new RegExp(escapeRegExp("\\\\X2\\\\"),"g"), "#dyn#");
			str = str.replace(new RegExp(escapeRegExp("\\\\X0\\\\"),"g"), "#fyn#");
			str = str.replace(new RegExp(escapeRegExp("\\X2\\"),"g"), "#dyn#");
			str = str.replace(new RegExp(escapeRegExp("\\X0\\"),"g"), "#fyn#");
			str =str.replace(new RegExp("#dyn#([a-zA-Z0-9_]{4})#fyn#","g"),function (x) { 
			return chars.decode[x.replace("#dyn#","").replace("#fyn#","")] ? chars.decode[x.replace("#dyn#","").replace("#fyn#","")] : x.replace("#dyn#","\\X2\\").replace("#fyn#","\\X0\\");
			});
			return  str;
		}
	} else return "";
	
    
	}

self.onmessage = function(e) {
    try {
      const opt_filterObject = e.data.filterObject;
      const opt_section = decode(opt_filterObject.section, true);
      const opt_sectionFalse = decode(opt_filterObject.section, false);
      const opt_property = decode(opt_filterObject.property, true);
      const opt_propertyFalse = decode(opt_filterObject.property, false);
      const opt_sectionC = opt_filterObject.sectionC ? decode(opt_filterObject.sectionC, true) : "";
      const opt_propertyArea = opt_filterObject.propertyArea ? decode(opt_filterObject.propertyArea, true) : "";
      const opt_propertyVolume = opt_filterObject.propertyVolume ? decode(opt_filterObject.propertyVolume, true) : "";
      const opt_value = decode(opt_filterObject.propertyValue, true);
      const opt_valueFalse = decode(opt_filterObject.propertyValue, false);
      const opt_isBatOrNiv = opt_filterObject.isBatOrNiv ? decode(opt_filterObject.isBatOrNiv, true) : "";
  
      let opt_volume = 0;
      let opt_area = 0;
      let opt_objects = e.data.objects || [];
      let opt_global = false;
      const opt_bats = e.data.bats || [];
  
      // Si le filtre concerne les niveaux
      if (opt_property === "Niveau" || opt_property === "classBim") {
        const opt_storeys = e.data.storeys || [];
        opt_global = true;
        for (let s in opt_storeys) {
          if (opt_storeys[s].name === opt_value) {
            opt_objects = opt_storeys[s].children;
            break;
          }
        }
      }
  
      if (opt_isBatOrNiv === "bat") {
        opt_objects = [];
        for (let b in opt_bats) {
          if (opt_bats[b].name === opt_value) {
            for (let m in opt_bats[b].metaModels) {
              const opt_metaObjects = opt_bats[b].metaModels[m].metaObjects;
              for (let c in opt_metaObjects) {
                if (opt_objects.indexOf(opt_metaObjects[c]) === -1) {
                  opt_objects.push(opt_metaObjects[c]);
                }
              }
            }
          }
        }
      }
  
      const opt_idsSet = new Set();
      const opt_ids = [];
  
      for (let k in opt_objects) {
        const opt_object = opt_objects[k];
        const opt_propertySets = opt_object.propertySets;
        let opt_oVolume = 0,
            opt_oArea = 0;
        let opt_addCotes = false;
  
        for (let i in opt_propertySets) {
          const opt_propertySet = opt_propertySets[i];
          if (!opt_propertySet) continue;
  
          if (opt_global) {
            if (opt_propertySet.name === opt_sectionC) {
              const opt_props = opt_propertySet.properties;
              for (let c in opt_props) {
                const opt_prop = opt_props[c];
                if (opt_prop.name === opt_propertyArea) {
                  opt_oArea = Number(opt_prop.value);
                }
                if (opt_prop.name === opt_propertyVolume) {
                  opt_oVolume = Number(opt_prop.value);
                }
              }
            }
          } else {
            if (opt_section && opt_property) {
              if (opt_propertySet.name === opt_sectionC) {
                const opt_props = opt_propertySet.properties;
                for (let c in opt_props) {
                  const opt_prop = opt_props[c];
                  if (opt_prop.name === opt_propertyArea) {
                    opt_oArea = Number(opt_prop.value);
                  }
                  if (opt_prop.name === opt_propertyVolume) {
                    opt_oVolume = Number(opt_prop.value);
                  }
                }
              }
              const opt_decodedSetNameFalse = decode(opt_propertySet.name, false);
              if (opt_decodedSetNameFalse === opt_sectionFalse) {
                const opt_props = opt_propertySet.properties;
                for (let j in opt_props) {
                  const opt_prop = opt_props[j];
                  if (
                    decode(opt_prop.name, false) === opt_propertyFalse &&
                    decode(opt_prop.value, false) === opt_valueFalse
                  ) {
                    if (!opt_idsSet.has(opt_object.id)) {
                      opt_idsSet.add(opt_object.id);
                      opt_ids.push(opt_object.id);
                    }
                    opt_addCotes = true;
                  }
                }
              }
            }
          }
        }
  
        if (opt_global) {
          if (!opt_idsSet.has(opt_object.id)) {
            opt_idsSet.add(opt_object.id);
            opt_ids.push(opt_object.id);
            opt_volume += opt_oVolume;
            opt_area += opt_oArea;
          }
        } else {
          if (opt_idsSet.has(opt_object.id) && opt_addCotes) {
            opt_volume += opt_oVolume;
            opt_area += opt_oArea;
          }
        }
      }
  
      // Envoi du résultat au thread principal
      self.postMessage({
        ids: opt_ids,
        result: {
          count: opt_ids.length,
          volume: opt_volume,
          area: opt_area
        }
      });
    } catch (err) {
      self.postMessage({ error: err.message });
    }
  };