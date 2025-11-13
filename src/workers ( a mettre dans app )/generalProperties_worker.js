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
  console.time("generalProperties xeokit");

  // Extraction des données transmises au Worker
  const filterObject = e.data.filterObject;
  const objects = e.data.objects;
  const buildings = e.data.buildings;
  const storeys = e.data.storeys;

  // Initialisation de l'objet résultat
  var result = {
    bat: {},
    niveau: {},
    code: {},
    custom: {}
  };

  console.log("filterObject", filterObject);

  // Pré-calcul des valeurs décodées pour "bat"
  var batSectionTrue = decode(filterObject.bat.section, true);
  var batSectionFalse = decode(filterObject.bat.section, false);
  var batPropertyTrue = decode(filterObject.bat.property, true);
  var batPropertyFalse = decode(filterObject.bat.property, false);

  // Pré-calcul pour "niveau"
  var niveauSectionTrue = decode(filterObject.niveau.section, true);
  var niveauSectionFalse = decode(filterObject.niveau.section, false);
  var niveauPropertyTrue = decode(filterObject.niveau.property, true);
  var niveauPropertyFalse = decode(filterObject.niveau.property, false);

  // Pré-calcul pour "code"
  var codeSectionTrue = decode(filterObject.code.section, true);
  var codeSectionFalse = decode(filterObject.code.section, false);
  var codePropertyUpper = decode(filterObject.code.property, true).toUpperCase();

  // Pré-calcul pour "custom"
  var customDecoded = {};
  for (var cu in filterObject.custom) {
    customDecoded[cu] = {
      sectionTrue: decode(filterObject.custom[cu].section.value, true),
      sectionFalse: decode(filterObject.custom[cu].section.value, false),
      propertyTrue: decode(filterObject.custom[cu].property.value, true).toUpperCase(),
      propertyFalse: decode(filterObject.custom[cu].property.value, false).toUpperCase()
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
              var val = decode(prop.value);
              result.bat[val] = (result.bat[val] || 0) + 1;
            }
          }
        }
      } else {
        // Utilisation des buildings passés au Worker
        for (var s in buildings) {
          var bName = decode(buildings[s].name);
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
              var val = decode(prop.value, true);
              result.niveau[val] = (result.niveau[val] || 0) + 1;
            }
          }
        }
      } else {
        // Utilisation des storeys passés au Worker
        for (var s in storeys) {
          var sName = decode(storeys[s].name);
          result.niveau[sName] = storeys[s].children ? storeys[s].children.length : 0;
        }
      }

      // Traitement pour "code"
      if (propertySet.name === codeSectionTrue || propertySet.name === codeSectionFalse) {
        var props = propertySet.properties;
        for (var c in props) {
          var prop = props[c];
          if (decode(prop.name).toUpperCase() === codePropertyUpper) {
            var val = decode(prop.value);
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
            var propNameUpper = decode(prop.name).toUpperCase();
            if (propNameUpper === customDecoded[cu].propertyTrue || propNameUpper === customDecoded[cu].propertyFalse) {
              var val = decode(prop.value);
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

  // Envoi du résultat vers le thread principal
  self.postMessage({ result: result });
};