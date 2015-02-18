var fs = require('fs');

//Variables ---------------
var warningsLogged = 0,
    warningsSkipped = 0;

//Constants & regexps -----

var regexpModule = new RegExp("angular.module\\(([A-Za-z0-9\"\\[\\]\', ]+)\\)","gm"),

    regexpModuleComponentSplit = new RegExp("\\.(service|directive|controller|factory|config)","g"),

    regexpModuleConfigs = new RegExp("\\.config\\(([A-Za-z0-9$\"\\[\\]\', ]+)(\\s?)fun","gm"),
    regexpModuleServices = new RegExp("\\.service\\(([A-Za-z0-9$\"\\[\\]\', ]+)(\\s?)fun","gm"),
    regexpModuleDirective = new RegExp("\\.directive\\(([A-Za-z0-9$\"\\[\\]\', ]+)(\\s?)fun","gm"),
    regexpModuleController = new RegExp("\\.controller\\(([A-Za-z0-9$\"\\[\\]\', ]+)(\\s?)fun","gm"),
    regexpModuleFactory = new RegExp("\\.factory\\(([A-Za-z0-9$\"\\[\\]\', ]+)(\\s?)fun","gm"),

    regexpTemplateUrl = /templateUrl:( ?)('|")([A-Za-z0-9.\/_-]+)('|")/,
    regexpTemplateUrls = /templateUrl:( ?)('|")([A-Za-z0-9.\/_-]+)('|")/g,
    regexpTemplate = /template:( ?)('|")(.+)('|"),/,
    regexpTemplates = /template:( ?)('|")(.+)('|"),/g,

    regexpCamelCase = /[A-Z]/g,
    regexpStrings = /('|")([A-Za-z0-9$]+)('|")/g,
    regexpNewLine = /(\n|\r)/g,
    regexpWrappers = /('|")/g,

    WARNING_MULTIPLE_REGISTRATION = 'multiple-registration',
    WARNING_MISSING_TEMPLATE_FILE = 'missing-template',
    WARNING_MISSING_DEPENDENCY = 'missing-dependency',
    WARNING_IGNORED_MODULE = 'ignored-module',
    WARNING_IGNORED_COMPONENT = 'ignored-component',
    WARNING_NOT_EXIST = 'not-exist',

    COMPONENT_SPLIT_ANCHOR = "---- CONTENT ANCHOR ----",

    COMPONENT_TYPE_CONFIG = ".config",
    COMPONENT_TYPE_SERVICE = ".service",
    COMPONENT_TYPE_CONTROLLER = ".controller",
    COMPONENT_TYPE_FACTORY = ".factory",
    COMPONENT_TYPE_DIRECTIVE = ".directive";

//Settings -----------------

var allowedWarningTypes = [
        WARNING_MULTIPLE_REGISTRATION,
        WARNING_MISSING_TEMPLATE_FILE,
        WARNING_MISSING_DEPENDENCY,
        WARNING_IGNORED_MODULE,
        WARNING_IGNORED_COMPONENT,
        WARNING_NOT_EXIST
    ],
    ignoredPaths = [],
    warningsWithFiles = false,
    mainModule = '',
    mainHTML = '';

var argLen = process.argv.length,
    getParamValue = function(pos){
        if(pos >= argLen) return undefined;
        return process.argv[pos];
    };
for(var argId = 2; argId < argLen; argId++) {
    var paramName = process.argv[argId];
    switch(paramName) {
        case "--main-module":
            mainModule = getParamValue(++argId);
            break;
        case "--main-html":
            mainHTML = getParamValue(++argId);
            break;
        case "--ignore-path":
            ignoredPaths = getParamValue(++argId).split(",");
            break;
        case "--warning-files":
            warningsWithFiles = true;
            break;
        case "--ignore-warning":
            var ignored = getParamValue(++argId).split(",");
            allowedWarningTypes = allowedWarningTypes.filter(function(warningType){
                return ignored.indexOf(warningType) == -1;
            });
            break;
        default:
            console.warn("Unknown parameter '" + paramName + "'");
            break;
    }
}

if(!mainModule || mainModule == "") {
    console.warn("Main module is not set. You cannot map dependencies without setting main module (use --main-module <module name>)");
    return;
}

if(!mainHTML || mainHTML == "") {
    console.warn("Main HTML file is not set. You cannot map dependencies without setting main HTML file (use --main-html <filename>)");
    return;
}

//Types --------------------

/**
 * Creates module with dependencies
 * @param {string} name
 * @param {string} filename
 * @param {Array} dependencies
 * @constructor
 */
var Module = function(name,filename,dependencies){
    this.name = name;
    this.filename = filename;
    this.dependencies = dependencies;
    this.components = {};
    this.processed = false;
    this.included = false;
};
Module.prototype.addComponent = function(component){
    if(this.components.hasOwnProperty(component.name)) {
        postWarning(WARNING_MULTIPLE_REGISTRATION, this, " is registering component '" + component.name + "' multiple times");
    }
    this.components[component.name] = component;
};
Module.prototype.isUsed = function(){
    return this.included;
};
Module.prototype.markAsUsed = function(){
    this.included = true;
};

/**
 * Creates component with dependencies
 * @param {string} name
 * @param {string} type
 * @param {Module} module
 * @param {Array} dependencies
 * @param {string=} source
 * @constructor
 */
var Component = function(name,type,module,dependencies,source){
    this.name = name;
    this.type = type;
    this.module = module;
    this.dependencies = dependencies;
    this.source = source || "";
    this.included = false;

    if(this.type == COMPONENT_TYPE_DIRECTIVE) {
        this.directiveName = deCamelCase(this.name);
    }
};
Component.prototype.getName = function(){
    return this.name;
};
Component.prototype.isUsed = function(){
    return this.included;
};
Component.prototype.markAsUsed = function(){
    this.included = true;
};

//Helper functions --------------

/**
 * Returns content of string's string
 * @param {string} str
 * @returns {string}
 */
function captureContent(str){
    var len = str.length,
        i,
        start = 0,
        currentChar = "",
        prevChar = "",
        contentChar = "";

    for(i = 0; i < len; i++) {
        currentChar = str[i];
        if(contentChar == "" && (currentChar == "'" || currentChar == '"')) {
            contentChar = currentChar;
            start = i;
        } else if(currentChar == contentChar && prevChar != "\\") {
            return str.substr(start,i);
        }
        prevChar = str[i];
    }
    return "";
}

/**
 * Create directive-like string from camelCase
 * @param {string} str
 * @returns {string}
 */
function deCamelCase(str){
    return str.replace(regexpCamelCase,function(letter,pos){
        return (pos == 0 ? letter : "-" + letter).toLowerCase();
    });
}

/**
 * Prints warning to console (+ checks for warning type and ignores)
 * @param {string} type
 * @param {Module} module
 * @param {string} str
 */
function postWarning(type, module, str){
    if(allowedWarningTypes.indexOf(type) > -1) {
        if(warningsWithFiles) {
            console.warn(module.filename + ": Module '" + module.name + "'" + str);
        } else {
            console.warn("Module '" + module.name + "'" + str);
        }
        warningsLogged++;
    } else {
        warningsSkipped++;
    }
}

/**
 * Returns list of files found in folder & subfolders
 * @param {string} path
 * @param {string} suffix
 * @returns {Array}
 */
function readFolder(path, suffix) {
    var list = [];
    fs.readdirSync(path).forEach(function (fileOrDir) {
        var stat = fs.lstatSync(path + "/" + fileOrDir);
        if (stat.isFile() && fileOrDir.indexOf("."+suffix) == fileOrDir.length - (suffix.length +1)) {
            list.push(path + "/" + fileOrDir);

        } else if (stat.isDirectory() && path != "src/styleguide" && path != "src/assets") {
            list = list.concat(readFolder(path + "/" + fileOrDir,suffix));
        }
    });
    return list;
}

/**
 * Remove " & ' from string
 * @param {string} str
 * @returns {string}
 */
function removeWrappers(str){
    return str.replace(regexpWrappers,"");
}

/**
 * Returns object with module name and array of dependencies
 * @param {string} moduleHeader
 * @param {string} filepath
 * @returns {Module}
 */
function getModuleInfo(moduleHeader,filepath) {
    var moduleName = "",
        dependencies = moduleHeader.match(regexpStrings);

    if (dependencies && dependencies.length > 0) {
        dependencies = dependencies.map(removeWrappers);
        moduleName = dependencies[0];
        dependencies = dependencies.filter(function (item) {
            return item != moduleName;
        });

    } else {
        moduleName = removeWrappers(moduleHeader);
        dependencies = [];
    }

    return new Module(moduleName,filepath,dependencies);
}

//Workflow -----------------
var allModules = {},
    allComponents = {},
    allDirectives = {},
    ignoredDependencies = ["ngRoute","ngAnimate"],
    ignoredComponents = ["$q","$window","$location","$scope","$rootScope","$http","$timeout","$routeParams","$routeProvider","$animate","$compile","$controller","$filter","$sce"];

var componentName,
    moduleName;

var registerComponent = function(name,module,component){
    if(allComponents.hasOwnProperty(name)) {
        postWarning(WARNING_MULTIPLE_REGISTRATION, module, " is registering component '" + component.getName() + "' which is already registered");
    }
    allComponents[name] = component;
    module.addComponent(component);
};

//1) Read source files
var sourceFiles = readFolder("./","js")
    .map(function(filepath){
        return filepath.replace(".//","");
    })
    .filter(function(item){
        for(var p = 0; p < ignoredPaths.length; p++) if(item.indexOf(ignoredPaths[p]) == 0) return false;
        return true;
    });

//2) Go trough each source file and read module name & dependencies
//[sourceFiles[5]].forEach(function(filepath){
sourceFiles.forEach(function(filepath){
    var fullContent = fs.readFileSync(filepath).toString().replace(regexpNewLine,"");
    var moduleName = "";

    var separateModuleContents = fullContent.split("angular.module");
    separateModuleContents.forEach(function(content){
        var module;

        //Read module name & dependencies
        var modulesMatch = ("angular.module" + content).match(regexpModule);
        if(modulesMatch && modulesMatch.length > 0) {
            module = getModuleInfo(modulesMatch[0],filepath);
            module.file = filepath;
            module.included = false;
            allModules[module.name] = module;
            moduleName = module.name;
        } else {
            //Skip reading controllers etc. from module as there is no module :)
            return
        }

        var components = content.replace(regexpModuleComponentSplit,COMPONENT_SPLIT_ANCHOR + " .$1").split(COMPONENT_SPLIT_ANCHOR),
            i,
            len = components.length,
            componentName;

        for(i = 1; i < len; i++) {
            var component = components[i];

            //Read module configs
            var configsMatch = component.match(regexpModuleConfigs);
            if(configsMatch && configsMatch.length > 0) {
                var configs = configsMatch[0].match(regexpStrings).map(removeWrappers);
                componentName = module.name+".config";
                registerComponent(componentName, module, new Component(componentName,COMPONENT_TYPE_CONFIG,module,configs,component));
                continue;
            }

            //Read module services
            var servicesMatch = component.match(regexpModuleServices);
            if(servicesMatch && servicesMatch.length > 0) {
                var services = servicesMatch[0].match(regexpStrings).map(removeWrappers);
                componentName = services[0];
                services = services.slice(1);
                registerComponent(componentName, module, new Component(componentName,COMPONENT_TYPE_SERVICE,module,services,component));
                continue;
            }

            //Read module directives
            var directivesMatch = component.match(regexpModuleDirective);
            if(directivesMatch && directivesMatch.length > 0) {
                var directives = directivesMatch[0].match(regexpStrings).map(removeWrappers);
                componentName = directives[0];
                directives = directives.slice(1);
                registerComponent(componentName, module, new Component(componentName,COMPONENT_TYPE_DIRECTIVE,module,directives,component));
                continue;
            }

            //Read module controllers
            var controllersMatch = component.match(regexpModuleController);
            if(controllersMatch && controllersMatch.length > 0) {
                var controllers = controllersMatch[0].match(regexpStrings).map(removeWrappers);
                componentName = controllers[0];
                controllers = controllers.slice(1);
                registerComponent(componentName, module, new Component(componentName,COMPONENT_TYPE_CONTROLLER,module,controllers,component));
                continue;
            }

            //Read module factories
            var factoriesMatch = component.match(regexpModuleFactory);
            if(factoriesMatch && factoriesMatch.length > 0) {
                var factories = factoriesMatch[0].match(regexpStrings).map(removeWrappers);
                componentName = factories[0];
                factories = factories.slice(1);
                registerComponent(componentName, module, new Component(componentName,COMPONENT_TYPE_FACTORY,module,factories,component));
            }
        }

    });
});

//3) Read directive names from components
for(componentName in allComponents) if(allComponents.hasOwnProperty(componentName) && allComponents[componentName].type == COMPONENT_TYPE_DIRECTIVE) {
    var directive = allComponents[componentName];
    allDirectives[directive.directiveName] = directive;
}

//4) Check basic module & its dependencies
var markDependenciesFromHtml = function(html){
    for(var directiveName in allDirectives) if(allDirectives.hasOwnProperty(directiveName) && html.indexOf(directiveName) > -1) {
        allDirectives[directiveName].markAsUsed();
    }
};

var markDependencies = function(moduleName){
    //Check for existence
    if(!allModules.hasOwnProperty(moduleName)) {
        console.warn("Referenced module '" + moduleName + "' does not exist!");
        return
    }

    //Read module
    var module = allModules[moduleName];

    //Check if it has been processed
    if(module.processed) {
        return;
    }

    //Mark module as included
    module.markAsUsed();
    module.processed = true;

    //Go trough dependencies
    module.dependencies.forEach(function(dependency){
        if(ignoredDependencies.indexOf(dependency) == -1) {
            markDependencies(dependency);
        }
    });

    //Go trough components
    for(var componentName in module.components) if(module.components.hasOwnProperty(componentName)) {
        var component = module.components[componentName];
        component.dependencies.forEach(function(dependencyName){
            if(ignoredComponents.indexOf(dependencyName) == -1) {
                if(!allComponents.hasOwnProperty(dependencyName)) {
                    postWarning(WARNING_NOT_EXIST,module," > '" + component.getName() + "' is referencing '" + dependencyName + "' which does not exist!");
                } else {
                    var dependency = allComponents[dependencyName];
                    dependency.markAsUsed();
                    if(module.name != dependency.module.name && module.dependencies.indexOf(dependency.module.name) == -1) {
                        postWarning(WARNING_MISSING_DEPENDENCY,module," > '" + component.getName() + "' referenced component '" + dependencyName + "' but it's missing module depencency '" + dependency.module.name + "'!");
                    }
                }
            }
        });

        //Check for templateUrls
        var templateUrls = component.source.match(regexpTemplateUrls);
        if(templateUrls) {
            templateUrls = templateUrls.map(function (templateUrl) {
                return captureContent(templateUrl).replace(regexpWrappers, "");
            });
            templateUrls.forEach(function (file) {
                markDependenciesFromHtml(fs.readFileSync(file).toString());
            });
        }

        //Check for template
        var templates = component.source.match(regexpTemplates);
        if(templates) templates.forEach(function(template){
            template = captureContent(captureContent(template.match(regexpTemplate)[0])).substr(1);
            markDependenciesFromHtml(template);
        });
    }
};
markDependenciesFromHtml(fs.readFileSync(mainHTML).toString());
markDependencies(mainModule);

//3) Check dependencies & mark as included
for(moduleName in allModules) if(allModules.hasOwnProperty(moduleName)) {
    var module = allModules[moduleName];
    if(!module.isUsed()) postWarning(WARNING_IGNORED_MODULE, module, " is not used");
}
for(componentName in allComponents) if(allComponents.hasOwnProperty(componentName)) {
    var component = allComponents[componentName];
    if(!component.isUsed() && component.module.isUsed() && component.type == COMPONENT_TYPE_DIRECTIVE) postWarning(WARNING_IGNORED_COMPONENT, component.module, " > '" + component.getName() + "' is not used");
}

console.warn("---------------------------");
console.warn(warningsLogged + " visible warnings");
console.warn(warningsSkipped + " silent warnings");
console.warn((warningsLogged + warningsSkipped) + " warnings at total");
