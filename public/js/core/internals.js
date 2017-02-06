var Lobster = Lobster || {};
var CPP = Lobster.CPP = Lobster.CPP || {};




var SemanticProblems = Lobster.SemanticProblems = Class.extend({
    _name: "SemanticProblems",
    init: function() {
        this.errors = [];
        this.warnings = [];
        this.widgets = [];
    },

    addWidget : function(widget){
        this.widgets.push(widget);
    },

    push : function(elem){
        if (elem._cssClass === "error"){
            this.errors.push(elem);
        }
        else if (elem._cssClass === "warning"){
            this.warnings.push(elem);
        }
        else{
            this.warnings.push(elem); // TODO this is a hack
        }
    },
    pushAll : function(elems){
        if (Array.isArray(elems)){
            for(var i = 0; i < elems.length; ++i){
                this.push(elems[i]);
            }
        }
        else{
            // assuming elems is a SemanticProblems
            this.errors.pushAll(elems.errors);
            this.warnings.pushAll(elems.warnings);
            this.widgets.pushAll(elems.widgets);
        }
    },
    clear : function(){
        this.errors.clear();
        this.warnings.clear();
        this.widgets.clear();
    },
    hasErrors : function(){
        return this.errors.length > 0;
    }
});



var CPPCode = Lobster.CPPCode = Class.extend({
    _name: "CPPCode",
    _nextId: 0,
    initIndex: "pushChildren",
    // context parameter is usually just parent code element in form
    // {parent: theParent}
    init: function (code, context) {
        this.code = code;

        assert(context.parent !== undefined || context.isMainCall);
        this.id = CPPCode._nextId++;
        this.semanticProblems = SemanticProblems.instance();
        this.children = [];
        this.sub = {};

        this.i_setContext(context);
    },

    i_setContext : function(context){

        this.context = context;

        // Find function context if none set
        if (!this.context.func && this.context.parent){
            this.context.func = this.context.parent.context.func;
        }

        this.parent = context.parent;
        if (this.parent) { this.parent.children.push(this); }
    },

    compile: Class._ABSTRACT,

    tryCompile : function(){
        try{
            return this.compile.apply(this, arguments);
        }
        catch(e){
            if (isA(e, SemanticException)){
                this.semanticProblems.push(e.annotation(this));
            }
            else{
                console.log(e.stack);
                throw e;
            }
        }
        return this.semanticProblems;
    },

    i_compileChild : function(child){
        var childProbs = child.compile.apply(child, Array.prototype.slice.call(arguments, 1));
        this.semanticProblems.pushAll(childProbs);
        return !childProbs.hasErrors();
    },

    isTailChild : function(child){
        return {isTail: false};
    },

    done : function(sim, inst){
        sim.pop(inst);
    },

    createInstance : function(sim, parent){
        return CPPCodeInstance.instance(sim, this, this.initIndex, this.instType, parent);
    },

    createAndPushInstance : function(sim, parent){
        var inst = this.createInstance.apply(this, arguments);
        sim.push(inst);
        return inst;
    },

    createAndCompileChildExpr : function(childCode, scope, convertTo){
        var child = Expressions.createExpr(childCode, {parent: this});
        this.semanticProblems.pushAll(child.tryCompile(scope));
        if (convertTo){
            child = standardConversion(child, convertTo);
        }
        return child;
    },

    pushChildInstances : function(sim, inst){
        //If first time, start index at 0 and create an ordering
        if (!this.subSequence){
            this.subSequence = [];
            for(var subName in this.sub){
                this.subSequence.push(subName);
            }
        }
        inst.childInstances = inst.childInstances || {};
        for(var i = this.subSequence.length-1; i >= 0; --i){
            var subName = this.subSequence[i];
            var child = this.sub[subName];
            if (Array.isArray(child)){
                // Note: no nested arrays, but that really seems unnecessary
                var childArr = inst.childInstances[subName] = [];
                for(var j = child.length-1; j >= 0; --j){
                    childArr.unshift(child[j].createAndPushInstance(sim, inst));
                }
            }
            else{
                inst.childInstances[subName] = child.createAndPushInstance(sim, inst);
            }
        }
        //inst.send("wait", this.sub.length);
    },

    childInstance : function(sim, inst, name){
        return inst && inst.childInstances && inst.childInstances[name];
    },

    executionContext : function(sim, inst){
        return inst.funcContext;
    },

    upNext : function(sim, inst){
        // Evaluate subexpressions
        if (inst.index === "pushChildren"){
            this.pushChildInstances(sim, inst);
            inst.index = "afterChildren";
            inst.wait();
            return true;
        }
        else if (inst.index === "done"){
            this.done(sim, inst);
            return true;
        }
        return false;
    },

    stepForward : function(sim, inst){

    },

    explain : function(sim, inst){
        return {message: "[No explanation available.]", ignore: true};
    },
    describe : function(sim, inst){
        return {message: "[No description available.]", ignore: false};
    }
});


var CPPCodeInstance = Lobster.CPPCodeInstance = DataPath.extend({
    _name: "CPPCodeInstance",
    //silent: true,
    init: function (sim, model, index, stackType, parent) {
        this.initParent();
        this.sim = sim;
        this.model = model;
        this.index = index;

        this.stackType = stackType;

        this.subCalls = Entities.List.instance();
        this.parent = parent;
        this.pushedChildren = [];
        assert(this.parent || this.model.context.isMainCall, "All code instances must have a parent.");
        assert(this.parent !== this, "Code instance may not be its own parent");
        if (this.parent) {

            if (this.stackType != "call") {
                this.parent.pushChild(this);
            }
            else {
                this.parent.pushSubCall(this);
            }

            // Will be replaced later in call instance subclass with self
            this.funcContext = this.parent.funcContext;

        }

        if (this.model.context.isMainCall){
            this.funcContext = this;
        }

        this.stepsTaken = sim.stepsTaken();
        this.pauses = {};
    },
    send: function(){
        return CPPCodeInstance._parent.send.apply(this, arguments);
    },
	instanceString : function(){
		return "instance of " + this._name + " (" + this.model._name + ")";
	},
	stepForward : function(){
		return this.model.stepForward(this.sim, this);
	},
	upNext : function(){
        for(var key in this.pauses){
            var p = this.pauses[key];
            if (p.pauseWhenUpNext ||
                p.pauseAtIndex !== undefined && this.index == p.pauseAtIndex){
                this.sim.pause();
                p.callback && p.callback();
                delete this.pauses[key];
                break;
            }
        }
        this.send("upNext");
        this.funcContext.send("currentFunction");
        return this.model.upNext(this.sim, this);
	},
    setPauseWhenUpNext : function(){
        this.pauses["upNext"] = {pauseWhenUpNext: true};
    },
    wait : function(){
        this.send("wait");
    },
	done : function(){
		if (this.model.done){
			return this.model.done(this.sim, this);
		}
	},
	pushed : function(){
//		this.update({pushed: this});
	},
	popped : function(){
        this.hasBeenPopped = true;
		this.send("popped", this);
	},
	pushChild : function(child){
        this.pushedChildren.push(child);
		this.send("childPushed", child);
	},
	pushSubCall : function(subCall){
		this.subCalls.push(subCall);
		this.send("subCallPushed", subCall);
	},
	setFrame : function(frame){
		this.frame = frame;
//		this.update({frameSet: this.frame});
	},
	findParent : function(stackType){
		if (stackType){
			var parent = this.parent;
			while(parent && parent.stackType != stackType){
				parent = parent.parent;
			}
			return parent;
		}
		else{
			return this.parent;
		}
	},
    findParentByModel : function(model){
        assert(isA(model, CPPCode));

        var parent = this.parent;
        while(parent && parent.model.id != model.id){
            parent = parent.parent;
        }
        return parent;
    },
    nearestReceiver : function(){
        return this.receiver || this.funcContext.receiver || this.parent && this.parent.nearestReceiver();
    },

    setEvalValue: function(value){
        this.evalValue = value;
        this.send("evaluated", this.evalValue);
    },

    executionContext : function(){
        return this.model.executionContext(this.sim, this);
    },

    explain : function(){
        return this.model.explain(this.sim, this);
    },
    describe : function(){
        return this.model.describe(this.sim, this);
    }
});


//var CPPCallInstance = Lobster.CPPCallInstance = CPPCodeInstance.extend({
//    init: function (sim, model, index, parent) {
//        this.initParent(sim, model, index, "call", parent);
//        this.funcContext = this;
//    }
//});


var Scope = Lobster.Scope = Class.extend({
    _name: "Scope",
    _nextPrefix: 0,
    HIDDEN: [],
    NO_MATCH: [],
    init: function(parent, sim){
        this.prefix = this._nextPrefix++;
        this.entities = {};
        this.parent = parent;
        this.sim = sim;
        if (!this.sim && this.parent) {
            this.sim = this.parent.sim;
        }
//        if (this.parent) {
//            this.parent.children.push(this);
//        }
    },
    instanceString : function(){
		var str = "";
		for(var key in this.entities){
			str += this.entities[key] + "\n";
		}
		return str;
	},
	addEntity : function(ent){
        if (isA(ent, StaticEntity)){
            this.addStaticEntity(ent);
        }
        else if (isA(ent, AutoEntity)){
            this.addAutomaticEntity(ent);
        }
        else if (isA(ent, ReferenceEntity)){
            this.addReferenceEntity(ent);
        }

        if (isA(ent, FunctionEntity)){
            if (!this.entities[ent.name]){
                this.entities[ent.name] = [];
            }
            this.entities[ent.name].push(ent);
        }
        else{
            this.entities[ent.name] = ent;
        }
	},
    ownEntity : function(name){
        return this.entities[name];
    },

    singleLookup : function(name, options){
        var result = this.lookup(name, options);
        if (Array.isArray(result)){
            return result[0];
        }
        else{
            return result;
        }
    },
    requiredLookup : function(name, options){
        var res = this.lookup(name, options);
        if (!res){
            throw SemanticExceptions.NotFound.instance(this, name);
        }
        else if(Array.isArray(res)){
            if (res === Scope.HIDDEN){
                throw SemanticExceptions.Hidden.instance(this, name);
            }
            if (res.length === 0){
                throw SemanticExceptions.NoMatch.instance(this, name,
                    options.paramTypes || options.params && options.params.map(function(p){return p.type;}),
                    options.isThisConst
                );
            }
            if (res.length > 1){
                throw SemanticExceptions.Ambiguity.instance(this, name);
            }
            return res[0];
        }

        return res;
    },
    qualifiedLookup : function(names, options){
        assert(Array.isArray(names) && names.length > 0);
        var scope = this.sim.globalScope;
        for(var i = 0; scope && i < names.length - 1; ++i){
            scope = scope.children[names[i].identifier];
        }

        if (!scope){
            return null;
        }

        var name = names.last().identifier;
        var result = scope.lookup(name, copyMixin(options, {qualified:true}));

        // Qualified lookup suppresses virtual function call mechanism, so if we
        // just looked up a MemberFunctionEntity, we create a proxy to do that.
        if (Array.isArray(result)){
            result = result.map(function(elem){
                return isA(elem, MemberFunctionEntity) ? elem.suppressedVirtualProxy() : elem;
            });
        }
        return result;
    },

    lookup : function(name, options){
        options = options || {};

        // Handle qualified lookup specially
        if (Array.isArray(name)){
            return this.qualifiedLookup(name, options);
        }

        var ent = this.entities[name];

        // If we don't have an entity in this scope and we didn't specify we
        // wanted an own entity, look in parent scope (if there is one)
        if (!ent && !options.own && this.parent){
            return this.parent.lookup(name, options);
        }

        // If we didn't find anything, return null
        if (!ent){
            return null;
        }

        // If it's an array, that means its a set of functions
        if (Array.isArray(ent)){

            var viable = ent;

            // If we're looking for an exact match of parameter types
            if (options.exactMatch){
                var paramTypes = options.paramTypes || options.params.map(function(p){return p.type});
                viable =  ent.filter(function(cand){
                    if (options.isThisConst && isA(cand.MemberFunctionEntity) && !cand.type.isThisConst){
                        return false;
                    }
                    return cand.type.sameParamTypes(paramTypes);
                });
            }

            // If we're looking for something that could be called with given parameter types
            else if (options.params || options.paramTypes){
                var params = options.params || options.paramTypes && fakeExpressionsFromTypes(options.paramTypes);
                viable = overloadResolution(ent, params, options.isThisConst) || [];
            }

            // Hack to get around overloadResolution sometimes returning not an array
            if (viable && !Array.isArray(viable)){
                viable = [viable];
            }

            // If viable is empty, not found.
            if (viable && viable.length === 0){
                // Check to see if we could have found it except for name hiding
                if (!options.own && this.parent){
                    var couldHave = this.parent.lookup(name, options);
                    if (couldHave && (!Array.isArray(couldHave) || couldHave.length === 1 || couldHave === Scope.HIDDEN)){
                        if (options.noNameHiding){
                            return couldHave;
                        }
                        else{
                            return Scope.HIDDEN;
                        }
                    }
                }
                return Scope.NO_MATCH;
            }
            else{
                return viable;
            }

        }

        // If it's not an array, just return it
        return ent;
    },

    // Don't use from outside >:(
    //lookupFunctions : function(name, context){
    //    if (this.entities.hasOwnProperty(name)){
    //        var own = this.entities[name];
    //        if (Array.isArray(own)){
    //            if (this.parent){
    //                return own.clone().pushAll(this.parent.lookupFunctions(name, context));
    //            }
    //            else{
    //                return own.clone();
    //            }
    //        }
    //    }
    //
    //    if (this.parent){
    //        return this.parent.lookupFunctions(name, context);
    //    }
    //    else{
    //        return [];
    //    }
    //},
    addCall : function(call){
        this.sim.addCall(call);
    },
    addAutomaticEntity : Class._ABSTRACT,
    addReferenceEntity : Class._ABSTRACT,
    addStaticEntity : Class._ABSTRACT


});

var BlockScope = Scope.extend({
    _name: "BlockScope",
    addAutomaticEntity : function(obj){
        assert(this.parent, "Objects with automatic storage duration should always be inside some block scope inside a function.");
        this.parent.addAutomaticEntity(obj);
    },
    addReferenceEntity : function(obj){
        assert(this.parent);
        this.parent.addReferenceEntity(obj);
    },
    addStaticEntity : function(ent) {
        this.sim.addStaticEntity(ent);
    }


});

var FunctionBlockScope = BlockScope.extend({
    _name: "FunctionBlockScope",
    init: function(parent, sim){
        this.initParent(parent, sim);
        this.automaticObjects = [];
        this.referenceObjects = [];
    },
    addAutomaticEntity : function(obj){
        this.automaticObjects.push(obj);
    },
    addReferenceEntity : function(obj){
        this.referenceObjects.push(obj);
    },
    addStaticEntity : function(ent) {

        this.sim.addStaticEntity(ent);
    }
});

var NamespaceScope = Scope.extend({

    init: function(name, parent, sim){
        this.initParent(parent, sim);
        this.name = name;
        this.children = {};
        if(this.parent){
            this.parent.addChild(this);
        }
    },
    addChild : function(child){
        if(child.name){
            this.children[child.name] = child;
        }
    },
    addAutomaticEntity : function(obj){
        assert(false, "Can't add an automatic entity to a namespace scope.");
    },
    addReferenceEntity : function(obj){
        assert(false, "TODO");
    },
    addStaticEntity : function(ent) {
        this.sim.addStaticEntity(ent);
    }
});


var ClassScope = NamespaceScope.extend({
    _name: "ClassScope",

    init: function(name, parent, base, sim){
        this.initParent(name, parent, sim);
        if(base){
            assert(isA(base, ClassScope));
            this.base = base;
        }
    },

    lookup : function(name, options){
        options = options || {};
        // If specified, will not look up in base class scopes
        if (options.noBase){
            return Scope.lookup.apply(this, arguments);
        }

        return this.memberLookup(name, options) || Scope.lookup.apply(this, arguments);
    },

    memberLookup : function(name, options){
        var own = Scope.lookup.call(this, name, copyMixin(options, {own:true}));
        if (!own){
            return this.base && this.base.memberLookup(name, options);
        }
        if (Array.isArray(own) && own.length === 0){
            // Check to see if we could have found it except for name hiding
            if (this.base){
                var couldHave = this.base.memberLookup(name, options);
                if (couldHave && (!Array.isArray(couldHave) || couldHave.length === 1 || couldHave === Scope.HIDDEN)){
                    if (options.noNameHiding){
                        return couldHave;
                    }
                    else{
                        return Scope.HIDDEN;
                    }
                }
            }
            return Scope.NO_MATCH;
        }
        return own;
    }
});


var CPPEntity = CPP.CPPEntity = DataPath.extend({
    _name: "CPPEntity",
    _nextEntityId: 0,
    init: function(name){
        this.initParent();
        this.entityId = CPPEntity._nextEntityId++;
        this.name = name;
        // TODO wat is this for?
        this.color = randomColor();
    },
    lookup : function(sim, inst){
        return this;
    },
    nameString : function(){
        return this.name;
    },
    describe : function(sim, inst){
        return {message: "[No description available.]"};
    },
    initialized : function(){
        // default impl, do nothing
    },
    isInitialized : function(){
        // default impl, do nothing
        return true;
    },
    setInitializer : function (init) {
        this.i_init = init;
    },
    getInitializer : function() {
        return this.i_init;
    }
});

var ReferenceEntity = CPP.ReferenceEntity = CPP.CPPEntity.extend({
    _name: "ReferenceEntity",
    storage: "automatic",
    init: function (decl, type) {
        this.initParent(decl && decl.name || null);
        this.decl = decl;
        this.type = type || decl.type;
    },
    allocated : function(){},
    bindTo : function(refersTo){
        assert(isA(refersTo, ObjectEntity) || isA(refersTo, ReferenceEntity)); // Must refer to a concrete thingy

        // If the thing we refer to is a reference, look it up first so we refer to the source.
        // This eliminates chains of references, which for now is what I want.
        if (isA(refersTo, ReferenceEntity)) {
            this.refersTo = refersTo.lookup();
        }
        else{
            this.refersTo = refersTo;
        }
        this.send("bound");
    },

    lookup : function(sim, inst){
        return inst.funcContext.frame.referenceLookup(this).lookup(sim, inst);
    },
    autoInstance : function(){
        return ReferenceEntityInstance.instance(this);
    },
    describe : function(){
        if (isA(this.decl, Declarations.Parameter)){
            return {message: "the reference parameter " + this.name};
        }
        else{
            return {message: "the reference " + this.name};
        }
    }
});


var ReferenceEntityInstance = CPP.ReferenceEntityInstance = CPP.ReferenceEntity.extend({
    _name: "ReferenceEntityInstance",
    init: function (entity) {
        this.initParent(entity.decl, entity.type);
    },
    bindTo : function(refersTo){
        assert(isA(refersTo, ObjectEntity) || isA(refersTo, ReferenceEntity)); // Must refer to a concrete thingy

        // If the thing we refer to is a reference, look it up first so we refer to the source.
        // This eliminates chains of references, which for now is what I want.
        if (isA(refersTo, ReferenceEntity)) {
            this.refersTo = refersTo.lookup();
        }
        else{
            this.refersTo = refersTo;
        }
        this.send("bound");
    },

    lookup : function(){
        // It's possible someone will be looking up the reference in order to bind it (e.g. auxiliary reference used
        // in function return), so if we aren't bound to anything return ourselves.
        return this.refersTo || this;
    }

});

var ObjectEntity = CPP.ObjectEntity = CPP.CPPEntity.extend({
    _name: "ObjectEntity",
    storage: Class._ABSTRACT,

    init: function(name, type){
        var self = this;
        this.initParent(name);
        this.type = type;
        this.size = type.size;
        assert(this.size != 0, "Size cannot be 0."); // SCARY

        this.nonRefType = this.type;
        if (isA(this.type, Types.Reference) && isA(this.type.refTo, Types.Class)){
            this.nonRefType = this.type.refTo;
        }

        if (isA(this.type, Types.Array)){
            this.isArray = true;
            // If array, make subobjects for all elements
            this.elemObjects = [];
            for(var i = 0; i < this.type.length; ++i){
                this.elemObjects.push(ArraySubobject.instance(this, i));
            }
        }
        else if (isA(this.nonRefType, Types.Class)){
            this.isClass = true;
            // If class, make subobjects for all members

            var classType = this.nonRefType;


            // TODO I think the 3 statements below can be replaced with:
            //this.subobjects = classType.subobjects.map(function(mem){
            //    return mem.objectInstance(self);
            //});
            this.baseSubobjects = classType.baseSubobjects.map(function(mem){
                return mem.objectInstance(self);
            });
            this.memberSubobjects = classType.objectMembers.map(function(mem){
                return mem.objectInstance(self);
            });
            this.subobjects = this.baseSubobjects.concat(this.memberSubobjects);

            //if (classType.base){
            //    this.subobjects.push(BaseClassSubobject.instance(classType.base, this));
            //}

            //for(var i = 0; i < classType.objectMembers.length; ++i){
            //    this.subobjects.
            //    this.subobjects.push(MemberSubobject.instance(classType.objectMembers[i].type, this, classType.objectMembers[i].name));
            //}
        }
    },
    instanceString : function(){
        return "@"+ this.address;
    },
    valueString : function(){
        return this.type.valueToString(this.rawValue());
    },
    nameString : function(){
        return this.name || "0x" + this.address;
    },
    coutString : function(){
        return this.type.coutString(this.rawValue());
    },
    isAlive : function(){
        return !!this.alive;
    },
    allocated : function(memory, address, inst){
        this.alive = true;
        this.memory = memory;
        this.address = address;

        // Allocate subobjects if needed
        if(this.isArray){
            var subAddr = this.address;
            for(var i = 0; i < this.type.length; ++i){
                this.elemObjects[i].allocated(memory, subAddr);
                subAddr += this.type.elemType.size;
            }
        }
        else if (this.isClass){
            var subAddr = this.address;
            for(var i = 0; i < this.subobjects.length; ++i){
                this.subobjects[i].allocated(memory, subAddr);
                subAddr += this.subobjects[i].type.size;
            }
        }

        if(this.defaultValue !== undefined){
            this.setValue(this.defaultValue);
        }
        else if (this.type.defaultValue !== undefined){
            this.setValue(this.type.defaultValue);
        }

        this.send("allocated");
    },
    deallocated : function(inst){
        this.alive = false;
        this.deallocatedByInst = inst;
        this.send("deallocated");
        // deallocate subobjects if needed
        //if(this.isArray){
        //    for(var i = 0; i < this.type.length; ++i){
        //        this.elemObjects[i].deallocated();
        //    }
        //}
        //else if (this.isClass){
        //    for(var i = 0; i < this.subobjects.length; ++i){
        //        this.subobjects[i].deallocated();
        //    }
        //}
    },
    obituary : function(){
        return {killer: this.deallocatedByInst};
    },
    getPointerTo : function(){
        assert(this.address, "Must be allocated before you can get pointer to object.");
        return Value.instance(this.address, Types.ObjectPointer.instance(this));
    },
    getSubobject : function(addr){
        if(this.isArray){
            for(var i = 0; i < this.type.length; ++i){
                var subObj = this.elemObjects[i];
                if (subObj.address === addr){
                    return subObj;
                }
            }
        }
        else if (this.isClass){
            for(var i = 0; i < this.subobjects.length; ++i){
                var subObj = this.subobjects[i];
                if (subObj.address === addr){
                    return subObj;
                }
            }
        }

        // Sorry, can't help you
        return null;
    },
    getValue : function(read){
        if (this.isValueValid()){
            return Value.instance(this.rawValue(read), this.type);
        }
        else{
            return Value.instance(this.rawValue(read), this.type, {invalid:true});
        }
    },
    readRawValue : function(){
        return this.rawValue(true);
    },
    rawValue : function(read){
        if (this.isArray){
            var arr = [];
            for(var i = 0; i < this.nonRefType.length; ++i){
                // use rawValue here to deeply remove Value object wrappers
                arr.push(this.elemObjects[i].rawValue(read));
            }
            return arr;
        }
        else if (this.isClass){
            var val = [];
            for(var i = 0; i < this.subobjects.length; ++i) {
                // use rawValue here to deeply remove Value object wrappers
                val.push(this.subobjects[i].rawValue(read));
            }
            return val;
        }
        else{
            if (read) {
                var bytes = this.memory.readBytes(this.address, this.size, this);
                var val = this.nonRefType.bytesToValue(bytes);
                this.send("valueRead", val);
                return val;
            }
            else {
                var bytes = this.memory.getBytes(this.address, this.size);
                return this.nonRefType.bytesToValue(bytes);
            }
        }
    },
    setValue : function(newValue, write){

        // It's possible newValue could be another object.
        // Handle this as a special case by first looking up value.
        if (isA(newValue, ObjectEntity)){
            newValue = newValue.getValue(write);
        }

        if (isA(newValue, Value)){
            this.setValidity(newValue.isValueValid());
            // Accept new RTTI
            this.type = newValue.type;
            newValue = newValue.rawValue();
        }
        else{
            // assume it was valid
            this.setValidity(true);
        }


        if (this.isArray){
            for(var i = 0; i < this.nonRefType.length; ++i){
                this.elemObjects[i].setValue(newValue[i], write);
            }
        }
        else if (this.isClass){
            for(var i = 0; i < this.subobjects.length; ++i) {
                this.subobjects[i].setValue(newValue[i], write);
            }
        }
        else{
            if(write){
                this.memory.writeBytes(this.address, this.nonRefType.valueToBytes(newValue), this);
                this.send("valueWritten", newValue);
            }
            else{
                this.memory.setBytes(this.address, this.nonRefType.valueToBytes(newValue), this);
            }
        }
    },

    readValue : function(){
        return this.getValue(true);
    },
    writeValue : function(newValue){
        this.setValue(newValue, true);
    },
    byteRead: function(addr){
        if (this.isArray){
            // If array, find the subobject containing the byte
            this.elemObjects[(addr - this.address) / this.nonRefType.elemType.size].byteRead(addr);
        }
        else if (this.isClass){
            var ad = this.address;
            for(var i = 0; i < this.subobjects.length; ++i) {
                var mem = this.subobjects[i];
                if(ad = ad + mem.type.size > addr){
                    ad.byteRead(addr);
                    break;
                }
            }
        }
        else{
            this.send("byteRead", {addr: addr});
        }
    },
    bytesRead: function(addr, length){
        if (this.isArray) {
            var beginIndex = Math.max(0, Math.floor(( addr - this.address ) / this.nonRefType.elemType.size));
            var endIndex = Math.min(
                    beginIndex + Math.ceil(length / this.nonRefType.elemType.size),
                this.nonRefType.length);

            for (var i = beginIndex; i < endIndex; ++i) {
                this.elemObjects[i].bytesRead(addr, length);
            }
        }
        else if (this.isClass){
            for(var i = 0; i < this.subobjects.length; ++i) {
                var mem = this.subobjects[i];
                if(addr < mem.address + mem.type.size && mem.address < addr + length){ // check for overlap
                    mem.bytesRead(addr, length);
                }
                else if (mem.address > addr +length){
                    // break if we are now in members past affected bytes
                    break;
                }
            }
        }
        else{
            this.send("bytesRead", {addr: addr, length: length});
        }
    },
    byteSet: function(addr, value){
        if (this.isArray){
            // If array, find the subobject containing the byte
            this.elemObjects[(addr - this.address) / this.nonRefType.elemType.size].byteSet(addr, value);
        }
        else if (this.isClass){
            var ad = this.address;
            for(var i = 0; i < this.subobjects.length; ++i) {
                var mem = this.subobjects[i];
                if(ad = ad + mem.type.size > addr){
                    mem.byteSet(addr, value);
                    break;
                }
            }
        }
        else{
            this.send("byteSet", {addr: addr, value: value});
        }
    },
    bytesSet: function(addr, values){
        var length = values.length;
        if (this.isArray) {
            var beginIndex = Math.max(0, Math.floor(( addr - this.address ) / this.nonRefType.elemType.size));
            var endIndex = Math.min(
                    beginIndex + Math.ceil(length / this.nonRefType.elemType.size),
                this.nonRefType.length);

            for (var i = beginIndex; i < endIndex; ++i) {
                this.elemObjects[i].bytesSet(addr, values);
            }
        }
        else if (this.isClass){
            for(var i = 0; i < this.subobjects.length; ++i) {
                var mem = this.subobjects[i];
                if(addr < mem.address + mem.type.size && mem.address < addr + length){ // check for overlap
                    mem.bytesSet(addr, values);
                }
                else if (mem.address > addr +length){
                    // break if we are now in members past affected bytes
                    break;
                }
            }
        }
        else{
            this.send("bytesSet", {addr: addr, values: values});
        }
    },
    byteWritten: function(addr, value){
        if (this.isArray){
            // If array, find the subobject containing the byte
            this.elemObjects[(addr - this.address) / this.nonRefType.elemType.size].byteWritten(addr, value);
        }
        else if (this.isClass){
            var ad = this.address;
            for(var i = 0; i < this.subobjects.length; ++i) {
                var mem = this.subobjects[i];
                if(ad = ad + mem.type.size > addr){
                    mem.byteWritten(addr, value);
                    break;
                }
            }
        }
        else{
            this.send("byteWritten", {addr: addr, value: value});
        }
    },
    bytesWritten: function(addr, values){
        var length = values.length;
        if (this.isArray) {
            var beginIndex = Math.max(0, Math.floor(( addr - this.address ) / this.nonRefType.elemType.size));
            var endIndex = Math.min(
                    beginIndex + Math.ceil(length / this.nonRefType.elemType.size),
                this.nonRefType.length);

            for (var i = beginIndex; i < endIndex; ++i) {
                this.elemObjects[i].bytesWritten(addr, values);
            }
        }
        else if (this.isClass){
            for(var i = 0; i < this.subobjects.length; ++i) {
                var mem = this.subobjects[i];
                if(addr < mem.address + mem.type.size && mem.address < addr + length){ // check for overlap
                    mem.bytesWritten(addr, values);
                }
                else if (mem.address > addr +length){
                    // break if we are now in members past affected bytes
                    break;
                }
            }
        }
        else{
            this.send("bytesWritten", {addr: addr, values: values});
        }
    },
    callReceived : function(){
        this.send("callReceived", this);
    },
    callEnded : function(){
        this.send("callEnded", this);
    },
    setValidity : function(valid){
        this._isValid = valid;
        this.send("validitySet", valid);
    },
    invalidate : function(){
        this.setValidity(false);
    },
    validate : function(){
        this.setValidity(true);
    },
    isValueValid : function(){
        return this._isValid && this.type.isValueValid(this.rawValue());
    },
    describe : function(){
        var w1 = isA(this.decl, Declarations.Parameter) ? "parameter " : "object ";
        return {name: this.name, message: "the " + w1 + (this.name || ("at 0x" + this.address))};
    },
    initialized : function(){
        this._initialized = true;
    },
    // TODO: doesn't work for class-type objects
    isInitialized : function(){
        return !!this._initialized;
    }
});


var ThisObject = CPP.ThisObject = ObjectEntity.extend({
    _name: "ThisObject",
    storage: "automatic"
});

var StaticEntity = CPP.StaticEntity = CPP.ObjectEntity.extend({
    _name: "StaticEntity",
    storage: "static",
    init: function(decl){
        this.initParent(decl.name, decl.type);
        this.decl = decl;
    },
    instanceString : function(){
        return this.name + " (" + this.type + ")";
    }

});

var DynamicObjectEntity = CPP.DynamicObjectEntity = CPP.ObjectEntity.extend({
    _name: "DynamicObjectEntity",
    storage: "dynamic",
    init: function(type, expr, name){
        this.initParent(name || null, type);
        this.expr = expr;
    },
    instanceString : function(){
        return "Heap object at " + this.address + " (" + this.type + ")";
    },
    leaked : function(sim){
        if (!this.hasBeenLeaked){
            this.hasBeenLeaked = true;
            sim.alert("Oh no! Some memory just got lost. It's highlighted in red in the memory display.")
            this.send("leaked");
        }
    },
    unleaked : function(sim){
        this.send("unleaked");
    },
    describe : function(){
        return {message: "the heap object " + (this.name || "at 0x" + this.address)};
    }
});

var AutoEntity = CPP.AutoEntity = CPP.CPPEntity.extend({
    _name: "AutoEntity",
    storage: "automatic",
    init: function(decl){
        this.initParent(decl.name);
        this.type = decl.type;
        this.decl = decl;
    },
    instanceString : function(){
        return this.name + " (" + this.type + ")";
    },
    objectInstance: function(){
        return AutoObjectInstance.instance(this);
    },
    lookup: function (sim, inst) {
        // We lookup first on the current stack frame and then call
        // lookup again in case it's a reference or something.
        return inst.funcContext.frame.lookup(this).lookup(sim, inst);
    },
    describe : function(){
        if (isA(this.decl, Declarations.Parameter)){
            return {message: "the parameter " + this.name};
        }
        else{
            return {message: "the local variable " + this.name};
        }
    }
});

//var TemporaryReferenceEntity = CPP.TemporaryReferenceEntity = CPP.CPPEntity.extend({
//    _name: "TemporaryReferenceEntity",
//    storage: "automatic",
//    init: function(refersTo){
//        assert(isA(refersTo, ObjectEntity));
//        this.initParent(refersTo.name);
//        this.type = decl.type;
//        this.decl = decl;
//    },
//    instanceString : function(){
//        return this.name + " (" + this.type + ")";
//    },
//    lookup: function (sim, inst) {
//        return inst.funcContext.frame.lookup(this);
//    }
//});

var AutoObjectInstance = CPP.AutoObjectInstance = CPP.ObjectEntity.extend({
    _name: "AutoObjectInstance",
    storage: "automatic",
    init: function(autoObj){
        this.initParent(autoObj.name, autoObj.type);
        this.decl = autoObj.decl;
        this.entityId = autoObj.entityId;
    },
    instanceString : function(){
        return this.name + " (" + this.type + ")";
    }
});



var ParameterEntity = CPP.ParameterEntity = CPP.CPPEntity.extend({
    _name: "ParameterEntity",
    storage: "automatic",
    init: function(func, num){
        assert(isA(func, FunctionEntity));
        assert(num !== undefined);

        this.num = num;
        this.func = func;

        this.initParent("Parameter "+num+" of "+func.name);
        this.type = func.type.paramTypes[num];
    },
    instanceString : function(){
        return this.name + " (" + this.type + ")";
    },
    objectInstance: function(){
        return AutoObjectInstance.instance(this);
    },
    lookup: function (sim, inst) {
        // In case function was polymorphic, look it up
        var func = this.func.lookup(sim, inst.parent);

        // Now we can look up object entity associated with this parameter
        var objEntity = func.decl.params[this.num].entity;

        return objEntity.lookup(sim, inst.calledFunction);
    },
    describe : function(){
        return {message: "parameter " + this.num + " of " + this.func.describe().message};
    }

});

var ReturnEntity = CPP.ReturnEntity = CPP.CPPEntity.extend({
    _name: "ReturnEntity",
    storage: "automatic",
    init: function(type){
        this.initParent("return value");
        this.type = type;
    },
    instanceString : function(){
        return "return value (" + this.type + ")";
    },
    lookup: function (sim, inst) {
        return inst.funcContext.returnObject.lookup(sim, inst);
    }
});

var ReceiverEntity = CPP.ReceiverEntity = CPP.CPPEntity.extend({
    _name: "ReceiverEntity",
    storage: "automatic",
    init: function(type){
        assert(isA(type, Types.Class));
        this.initParent(type.className);
        this.type = type;
    },
    instanceString : function(){
        return "function receiver (" + this.type + ")";
    },
    lookup: function (sim, inst) {
        var rec = inst.memberOf || inst.funcContext.receiver;
        return rec.lookup(sim, inst);
    },
    describe : function(sim, inst){
        if (inst){
            return {message: "the receiver of this call to " + inst.funcContext.describe(sim, inst.funcContext).message + " (i.e. *this) "};
        }
        else {
            return {message: "the receiver of this call (i.e. *this)"};
        }
    }
});



var NewObjectEntity = CPP.NewObjectEntity = CPP.CPPEntity.extend({
    _name: "NewObjectEntity",
    storage: "automatic",
    init: function(type){
        this.initParent(null);
        this.type = type;
    },
    instanceString : function(){
        return "object (" + this.type + ")";
    },
    lookup: function (sim, inst) {
        return inst.allocatedObject.lookup(sim, inst);
    },
    describe : function(){
        return {message: "the object ("+this.type+") created by new"};
    }

});

var RuntimeEntity = CPP.RuntimeEntity = CPP.ObjectEntity.extend({
    _name: "RuntimeEntity",
    storage: "automatic",
    init: function(type, inst){
        this.initParent(null, type);
        this.inst = inst;
    },
    instanceString : function(){
        return this.name + " (" + this.type + ")";
    },
    lookup: function (sim, inst) {
        return this.inst.evalValue.lookup(sim, inst);
    }
});

var ArraySubobjectEntity = CPP.ArraySubobjectEntity = CPP.CPPEntity.extend({
    _name: "ArraySubobjectEntity",
    storage: "none",
    init: function(arrayEntity, index){
        assert(isA(arrayEntity.type, Types.Array));
        this.initParent(arrayEntity.name + "[" + index + "]");
        this.arrayEntity = arrayEntity;
        this.type = arrayEntity.type.elemType;
        this.index = index;
    },
    instanceString : function(){
        return this.name + " (" + this.type + ")";
    },
    lookup: function (sim, inst) {
        return this.arrayEntity.lookup(sim, inst).elemObjects[this.index].lookup(sim, inst);
    },
    objectInstance : function(arrObj){
        return ArraySubobject.instance(arrObj, this.index);
    },
    describe : function(){
        var desc = {};
        var arrDesc = this.arrayEntity.describe();
        desc.message = "element " + this.index + " of " + arrDesc.message;
        if (arrDesc.name){
            desc.name = arrDesc.name + "[" + this.index + "]";
        }
        return desc;
    }
});

var BaseClassSubobjectEntity = CPP.BaseClassSubobjectEntity = CPP.CPPEntity.extend({
    _name: "BaseClassSubobjectEntity",
    storage: "none",
    init: function(type, memberOfType, access){
        assert(isA(type, Types.Class));
        this.initParent(type.className);
        this.type = type;
        if (!this.type._isInstance){
            this.type = this.type.instance(); // TODO remove once type is actually passed in as instance
        }
        this.memberOfType = memberOfType;
        this.access = access;
    },
    instanceString : function(){
        return this.name + " (" + this.type + ")";
    },
    lookup: function (sim, inst) {
        var memberOf = inst.memberOf || inst.funcContext.receiver;

        while(memberOf && !isA(memberOf.type, this.type)){
            memberOf = memberOf.type.base && memberOf.baseSubobjects[0];
        }
        assert(memberOf, "Internal lookup failed to find subobject in class or base classes.");

        return memberOf.lookup(sim, inst);
    },
    objectInstance : function(parentObj){
        return BaseClassSubobject.instance(this.type, parentObj);
    },
    describe : function(){
        return {message: "the " + this.name + " base object of " + this.memberOfType.className};
    }
});

var MemberSubobjectEntity = CPP.MemberSubobjectEntity = CPP.CPPEntity.extend({
    _name: "MemberSubobjectEntity",
    storage: "none",
    init: function(decl, memberOfType){
        this.initParent(decl.name);
        this.type = decl.type;
        if (!this.type._isInstance){
            this.type = this.type.instance(); // TODO remove once type is actually passed in as instance
        }
        this.decl = decl;
        this.memberOfType = memberOfType;
        this.access = decl.access;
    },
    instanceString : function(){
        return this.name + " (" + this.type + ")";
    },
    lookup: function (sim, inst) {
        var memberOf = inst.memberOf || inst.funcContext.receiver;

        while(memberOf && !isA(memberOf.type, this.memberOfType)){
            memberOf = memberOf.type.base && memberOf.baseSubobjects[0];
        }

        assert(memberOf, "Internal lookup failed to find subobject in class or base classses.");

        return memberOf.memberSubobjects[this.memberIndex].lookup(sim, inst);
    },
    objectInstance : function(parentObj){
        return MemberSubobject.instance(this.type, parentObj, this.name);
    },
    describe : function(sim, inst){
        if (inst){
            var memberOf = inst.memberOf || inst.funcContext.receiver;
            if (memberOf.name){
                return {message: this.memberOf.name + "." + this.name};
            }
            else{
                return {message: "the member " + this.name + " of " + memberOf.describe(sim, inst).message};
            }
        }
        else{
            return {message: "the " + this.name + " member of the " + this.memberOfType.className + " class"};
        }
    }
});

var AnonObject = CPP.AnonObject = CPP.ObjectEntity.extend({
    _name: "AnonObject",
    storage: "temp",
    init: function(type, name){
        this.initParent(name || null, type);
    },
    nameString : function(){
        return this.name || "@" + this.address;
    }/*,
    isAlive : function(){
      return false;
    }*/
});

var Subobject = CPP.Subobject = CPP.ObjectEntity.extend({
    _name: "Subobject",
    parentObject : Class._ABSTRACT,
    isAlive : function(){
        return this.parentObject().isAlive();
    },
    obituary : function(){
        return this.parentObject().obituary();
    }
});



var ArraySubobject = CPP.ArraySubobject = CPP.Subobject.extend({
    _name: "ArraySubobject",
    storage: "temp",
    init: function(arrObj, index){
        this.initParent(null, arrObj.type.elemType);
        this.arrObj = arrObj;
        this.index = index;
    },
    nameString : function(){
        return this.name || "@" + this.address;
    },
    parentObject : function(){
        return this.arrObj;
    },
    getPointerTo : function(){
        assert(this.address, "Must be allocated before you can get pointer to object.");
        return Value.instance(this.address, Types.ArrayPointer.instance(this.arrObj));
    },
    describe : function(){
        var desc = {};
        var arrDesc = this.arrObj.describe();
        desc.message = "element " + this.index + " of " + arrDesc.message;
        if (arrDesc.name){
            desc.name = arrDesc.name + "[" + this.index + "]";
        }
        return desc;
    }
});



var TemporaryObjectEntity = CPP.TemporaryObjectEntity = CPP.CPPEntity.extend({
    _name: "TemporaryObjectEntity",
    storage: "temp",
    init: function(type, creator, owner, name){
        this.initParent(name || null);
        this.type = type;
        this.creator = creator;
        this.setOwner(owner);
    },
    setOwner : function(newOwner){
        if (newOwner === this.owner)
        if (this.owner){
            this.owner.removeTemporaryObject(this);
        }
        this.owner = newOwner;
        this.owner.addTemporaryObject(this);
    },
    updateOwner : function(){
        var newOwner = this.creator.findFullExpression();
        if (newOwner === this.owner){ return; }
        if (this.owner){
            this.owner.removeTemporaryObject(this);
        }
        this.owner = newOwner;
        this.owner.addTemporaryObject(this);
    },
    objectInstance: function(creatorInst){
        var obj = creatorInst.sim.memory.allocateTemporaryObject(TemporaryObjectInstance.instance(this));

        var inst = creatorInst;
        while (inst.model !== this.owner){
            inst = inst.parent;
        }

        inst.temporaryObjects = inst.temporaryObjects || {};
        inst.temporaryObjects[obj.entityId] = obj;
        return obj;
    },
    lookup: function (sim, inst) {
        var ownerInst = inst;
        while (ownerInst.model !== this.owner){
            ownerInst = ownerInst.parent;
        }
        var tempObjInst = ownerInst.temporaryObjects[this.entityId];
        return tempObjInst && tempObjInst.lookup(sim, inst);
    }
});

var TemporaryObjectInstance = CPP.TemporaryObjectInstance = CPP.ObjectEntity.extend({
    _name: "TemporaryObject",
    storage: "temp",
    init: function(tempObjEntity){
        this.initParent(tempObjEntity.name, tempObjEntity.type);
        this.entityId = tempObjEntity.entityId;
    },
    nameString : function(){
        return "@" + this.address;
    }
});

var BaseClassSubobject = CPP.BaseClassSubobject = CPP.Subobject.extend({
    _name: "BaseClassSubobject",
    storage: "none",
    init: function(type, parent){
        assert(isA(type, Types.Class));
        this.initParent("-"+type.className, type);
        this.parent = parent;
        this.storage = parent.storage;
    },
    parentObject : function(){
        return this.parent;
    },
    nameString : function(){
        return this.parent.nameString();
    },
    describe : function(){
        return {message: "the " + this.type.className + " base of " + this.parentObject().describe().message};
    }
});

var MemberSubobject = CPP.MemberSubobject = CPP.Subobject.extend({
    _name: "MemberSubobject",
    storage: "none",
    init: function(type, parent, name){
        this.initParent(name || null, type);
        this.parent = parent;
        this.storage = parent.storage;
    },
    parentObject : function(){
        return this.parent;
    },
    nameString : function(){
        return this.parent.nameString() + "." + this.name;
    },
    describe : function(){
        var parent = this.parentObject();
        if (parent.name){
            return {message: parent.name + "." + this.name};
        }
        else{
            return {message: "the member " + this.name + " of " + parent.describe().message};
        }
    }
});

var createAnonObject = function(type, memory, address){
    var obj = AnonObject.instance(type);
    obj.allocated(memory, address);
    return obj;
};

var FunctionEntity = CPP.FunctionEntity = CPP.CPPEntity.extend({
    _name: "FunctionEntity",
    init: function(decl){
        this.initParent(decl && decl.name || null);
        this.type = decl && decl.type;
        this.name = decl && decl.name;
        this.decl = decl;
    },
    isStaticallyBound : function(){
        return true;
    },
    isVirtual : function(){
        return false;
    },
    instanceString : function() {
        return this.name;
    },
    nameString : function(){
        return this.name;
    },
    isLinked : function(){
        return isA(this.decl, FunctionDefinition) || isA(this.decl, MagicFunctionDefinition);
    },
    describe : function(sim, inst){
        return this.decl.describe(sim, inst);
    }
});


var MemberFunctionEntity = CPP.MemberFunctionEntity = CPP.FunctionEntity.extend({
    _name: "MemberFunctionEntity",
    isMemberFunction: true,
    init: function(decl, memberOfClass, virtual){
        this.initParent(decl);
        this.memberOfClass = memberOfClass;
        this.virtual = virtual;
        this.pureVirtual = decl.pureVirtual;
        // May be set to virtual if it's discovered to be an overrider
        // for a virtual function in a base class

        this.checkForOverride();
    },
    checkForOverride : function(){
        if (!this.memberOfClass.base){
            return;
        }

        // Find the nearest overrider of a hypothetical virtual function.
        // If any are virtual, this one would have already been set to be
        // also virtual by this same procedure, so checking this one is sufficient.
        // If we override any virtual function, this one is too.
        var overridden = this.memberOfClass.base.scope.singleLookup(this.name, {
            paramTypes: this.type.paramTypes, isThisConst: this.type.isThisConst,
            exactMatch:true, own:true, noNameHiding:true});

        if (overridden && isA(overridden, FunctionEntity) && overridden.virtual){
            this.virtual = true;
            // Check to make sure that the return types are covariant
            if (!covariantType(this.type.returnType, overridden.type.returnType)){
                throw SemanticExceptions.NonCovariantReturnTypes.instance(this, overridden);
            }
        }
    },
    isStaticallyBound : function(){
        return !this.virtual;
    },
    isVirtual : function(){
        return this.virtual;
    },
    isLinked : function(){
        return this.virtual && this.pureVirtual || FunctionEntity.isLinked.apply(this);
    },
    lookup : function(sim, inst){
        if (this.virtual){
            // If it's a virtual function start from the class scope of the dynamic type
            var receiver = inst.nearestReceiver().lookup(sim, inst);
            assert(receiver, "dynamic function lookup requires receiver");
            var dynamicType = receiver.type;

            // Sorry this is hacky :(
            // If it's a destructor, we look instead for the destructor of the dynamic type
            var func;
            if (isA(this.decl, DestructorDefinition)) {
                func = dynamicType.getDestructor();
            }
            else{
                func = dynamicType.scope.singleLookup(this.name, {
                    paramTypes: this.type.paramTypes, isThisConst: this.type.isThisConst,
                    exactMatch:true, own:true, noNameHiding:true});
            }
            assert(func, "Failed to find virtual function implementation during lookup.");
            return func;
        }
        else{
            return this;
        }
    },
    suppressedVirtualProxy : function(){
        return this.proxy({
            virtual: false
        });
    }

});


var PointedFunctionEntity = CPP.PointedFunctionEntity = CPP.FunctionEntity.extend({
    _name: "FunctionEntity",
    init: function(type){
        this.initParent(null);
        this.name = "Unknown function of type " + type;
        this.type = type;
    },
    isStaticallyBound : function(){
        return true;
    },
    instanceString : function() {
        return this.name;
    },
    nameString : function(){
        return this.name;
    },
    lookup : function(sim, inst){
        return inst.pointedFunction.lookup(sim,inst);
    },
    isLinked : function(){
        return true;
    }
});

//var FunctionEntityGroup = CPP.FunctionEntityGroup = CPP.CPPEntity.extend({
//    _name: "FunctionEntityGroup",
//    init: function(name){
//        this.initParent(name);
//        this.arr = [];
//    },
//    push : function(ent){
//        this.arr.push(ent);
//    },
//    instanceString : function() {
//        return this.name;
//    },
//    nameString : function(){
//        return this.name;
//    }
//});



var TypeEntity = CPP.TypeEntity = CPP.CPPEntity.extend({
    _name: "TypeEntity",
    init: function(decl){
        this.initParent(decl.name);
        this.type = decl.type;
        this.name = decl.name;
        this.decl = decl;
    },
    instanceString : function() {
        return "TypeEntity: " + this.type.instanceString();
    },
    nameString : function(){
        return this.name;
    }
});



var Memory = Lobster.Memory = DataPath.extend({
    _name: "Memory",
    init: function(capacity, staticCapacity, stackCapacity){
        this.initParent();

        this.capacity = capacity || 10000;
        this.staticCapacity = staticCapacity || Math.floor(this.capacity / 10);
        this.stackCapacity = stackCapacity || Math.floor((this.capacity - this.staticCapacity) / 2);
        this.heapCapacity = this.capacity - this.staticCapacity - this.stackCapacity;

        this.bubble = true;
        this.staticStart = 0;
        this.staticTop = this.staticStart + 4;
        this.staticEnd = this.staticStart + this.staticCapacity;

        this.stackStart = this.staticEnd;
        this.stackEnd = this.stackStart + this.stackCapacity;

        this.heapStart = this.stackEnd;
        this.heapEnd = this.heapStart + this.heapCapacity;

        this.temporaryStart = this.heapEnd + 100;
        this.temporaryBottom = this.temporaryStart;
        this.temporaryCapacity = 10000;
        this.temporaryEnd = this.temporaryStart + this.temporaryCapacity;

        assert(this.staticCapacity < this.capacity && this.stackCapacity < this.capacity && this.heapCapacity < this.capacity);
        assert(this.heapEnd == this.capacity);

    },
    act : {
        clear : function(){return false;} // prevent bubble for clear
    },
    reset : function(){

        // memory is a sequence of bytes, addresses starting at 0
        this.bytes = new Array(this.capacity + this.temporaryCapacity);
        for(var i = 0; i < this.capacity + this.temporaryCapacity; ++i){
            this.bytes[i] = 0;
        }

        this.objects = {};
        this.staticTop = this.staticStart+4;
        this.temporaryBottom = this.temporaryStart;

        this.stack = MemoryStack.instance(this, this.staticEnd);
        this.heap = MemoryHeap.instance(this, this.heapEnd);
        this.temporaryObjects = {};
        this.send("reset");
    },

//    clear : function(){
//        for(var i = 0; i < this.capacity; ++i){
//            this.bytes[i] = 0;
//        }
//        this.stack = null;
//        this.heap = null;
//        this.objects = {};
//        this.send("cleared");
//    },
    allocateObject : function(object, addr){
        this.objects[addr] = object;
        object.allocated(this, addr);
    },
    deallocateObject : function(addr, inst){
        assert(addr !== undefined);
        var obj = this.objects[addr];
        if (obj){
            obj.deallocated(inst);
        }
        // I'm just leaving the dead objects here for now, that way we can provide better messages if a dead object is looked up
        //delete this.objects[addr];
    },
    allocateStatic : function(object){
        this.allocateObject(object, this.staticTop);
        this.staticTop += object.size;
	},
    getByte : function(addr){
        return this.bytes[addr];
    },
    readByte : function(ad, fromObj){

        // Notify any other object that is interested in that byte
        var begin = ad - Types.maxSize;
        //for(var i = ad; begin < i; --i){
        //    var obj = this.objects[i];
        //    if (obj == fromObj) { continue; }
        //    if (obj && obj.size > ad - i){
        //        obj.byteRead(ad);
        //    }
        //}
        return this.bytes[ad];
    },
    getBytes : function(addr, num){
        return this.bytes.slice(addr, addr + num);
    },
    readBytes : function(ad, num, fromObj){
        var end = ad + num;

        // Notify any other object that is interested in that byte
        var begin = ad - Types.maxSize;
        //for(var i = end-1; begin < i; --i){
        //    var obj = this.objects[i];
        //    if (obj == fromObj) { continue; }
        //    if (obj && obj.size > ad - i){
        //        obj.bytesRead(ad, end-ad);//.send("bytesRead", {addr: ad, length: end-ad});
        //    }
        //}

        return this.bytes.slice(ad, end);
    },
    setByte : function(ad, value){
        this.bytes[ad] = value;

        // Notify any object that is interested in that byte
        var begin = ad - Types.maxSize;
        //for(var i = ad; begin < i; --i){
        //    var obj = this.objects[i];
        //    if (obj && obj.size > ad - i){
        //        obj.byteSet(ad, value);//.send("byteSet", {addr: ad, value: value});
        //    }
        //}
    },
    writeByte : function(ad, value, fromObj){
        this.bytes[ad] = value;

        // Notify any other object that is interested in that byte
        var begin = ad - Types.maxSize;
        //for(var i = ad; begin < i; --i){
        //    var obj = this.objects[i];
        //    if (obj == fromObj) { continue; }
        //    if (obj && obj.size > ad - i){
        //        obj.byteWritten(ad, value);//.send("byteWritten", {addr: ad, value: value});
        //    }
        //}
    },
    setBytes : function(ad, values){

        for(var i = 0; i < values.length; ++i){
            this.bytes[ad+i] = values[i];
        }

        // Notify any other object that is interested in that byte
        //var begin = ad - Types.maxSize;
        //for(var i = ad+values.length; begin < i; --i){
        //    var obj = this.objects[i];
        //    if (obj && obj.size > ad - i){
        //        obj.bytesSet(ad, values);//.send("byteSet", {addr: ad, values: values});
        //    }
        //}
    },
    writeBytes : function(ad, values, fromObj){

        //TODO remove this commented code
        //if (isA(fromObj, TemporaryObject)){
        //    var objBytes = this.temporaryObjects[fromObj.entityId];
        //    if (!objBytes){
        //        objBytes = new Array(fromObj.size);
        //        for(var i = 0; i < fromObj.size; ++i){
        //            objBytes[i] = 0;
        //        }
        //        this.temporaryObjects[fromObj.entityId] = objBytes;
        //    }
        //    return;
        //}

        for(var i = 0; i < values.length; ++i){
            this.bytes[ad+i] = values[i];
        }

        // Notify any other object that is interested in that byte
        //var begin = ad - Types.maxSize;
        //for(var i = ad+values.length-1; begin < i; --i){
        //    var obj = this.objects[i];
        //    if (obj == fromObj) { continue; }
        //    if (obj && obj.size > ad - i){
        //        obj.bytesWritten(ad, values);//.send("bytesWritten", {addr: ad, values: values});
        //    }
        //}
    },

//    makeObject : function(entity, addr){
//        return this.objects[addr] = CPPObject.instance(entity, this, addr);
//    },
    // Takes in a Value or ObjectEntity of pointer type. Must point to an object type
    // Returns the most recently allocated object at the given address.
    // This may be an object which is no longer alive (has been deallocated).
    getObject: function(ptr, type){
        assert(isA(ptr, Value) || isA(ptr, ObjectEntity));
        assert(ptr.type.ptrTo.isObjectType);
        type = type || ptr.type.ptrTo;

        var addr = ptr.rawValue();

        // Handle special cases for pointers with RTTI
        if (isA(ptr.type, Types.ArrayPointer)){
            return ptr.type.arrObj.getSubobject(addr) || createAnonObject(type, this, addr);
        }
        else if (isA(ptr.type, Types.ObjectPointer)  && ptr.type.isValueValid(addr)){
            return ptr.type.obj;
        }

        // Grab object from memory
        var obj = this.objects[addr];

        if (obj && (similarType(obj.type. type) || subType(obj.type, type))){
            return obj;
        }

        // If the object wasn't there or doesn't match the type we asked for (ignoring const)
        // then we need to create an anonymous object of the appropriate type instead
        return createAnonObject(type, this, addr);
    },
    allocateTemporaryObject: function(obj){
        this.allocateObject(obj, this.temporaryBottom);
        this.temporaryBottom += obj.type.size;
        this.temporaryObjects[obj.entityId] = obj;
        this.send("temporaryObjectAllocated", obj);
        return obj;
    },
    deallocateTemporaryObject: function(obj, inst){
        this.deallocateObject(obj, inst);
        //this.temporaryBottom += obj.type.size;
        delete this.temporaryObjects[obj];
        this.send("temporaryObjectDeallocated", obj);
    }
});

var MemoryStack = DataPath.extend({
    _name: "MemoryStack",
    init: function(memory, start){
        this.initParent();

        this.memory = memory;
        this.start = start;
        this.top = start;
        this.frames = [];
    },
    clear : function(){
        this.frames.length = 0;
        this.top = this.start;
    },
    topFrame : function(){
        return this.frames.last();
    },
    pushFrame : function(func){
        var frame = MemoryFrame.instance(func.funcDecl.scope, this.memory, this.top, func);
        this.top += frame.size;
        this.frames.push(frame);

        // Take care of reference parameters


        this.memory.send("framePushed", frame);
        return frame;
    },
    popFrame : function(inst){
        var frame = this.frames.pop();
        for (var key in frame.objects){
            var obj = frame.objects[key];
            this.memory.deallocateObject(obj.address, inst)
        }
        this.top -= frame.size;
        this.memory.send("framePopped", frame);
    },
    instanceString : function(){
        var str = "<ul class=\"stackFrames\">";
        for(var i = 0; i < this.frames.length; ++i){
            var frame = this.frames[i];
            str += "<li>" + frame.toString() + "</li>";
        }
        str += "</ul>";
        return str;
    }
});

var MemoryHeap = DataPath.extend({
    _name: "MemoryHeap",
    props : {
        memory: {type: Memory},
        bottom: {type: "number"}
    },
    init: function(memory, end){
        this.memory = memory;
        this.end = end;
        this.bottom = end;
        this.objectMap = {};

        this.initParent();
    },
    clear : function(){
        this.objects.length = 0;
    },
    newObject: function(obj){
        this.bottom -= obj.type.size;
        this.memory.allocateObject(obj, this.bottom);
        this.objectMap[obj.address] = obj;
        this.memory.send("heapObjectAllocated", obj);
        return obj;
    },

    deleteObject: function(addr, inst){
        var obj = this.objectMap[addr];
        if (obj) {
            delete this.objectMap[addr];
            this.memory.deallocateObject(addr, inst);
            this.memory.send("heapObjectDeleted", obj);
            // Note: responsibility for running destructor lies elsewhere
        }
        return obj;
    }
});

//TODO search for StackFrame, .stack, .heap, .objects

var MemoryFrame = Lobster.CPP.MemoryFrame = DataPath.extend({
    _name: "MemoryFrame",
    props : {
        scope: {type: FunctionBlockScope},
        memory: {type: Memory},
        start: {type: "number"},
        size: {type: "number"}
    },
    init: function(scope, memory, start, func){
        var self = this;
        this.scope = scope;
        this.memory = memory;
        this.start = start;
        this.func = func.funcDecl;
        var funcInst = func;

        this.initParent();

//        this.bubble = true; // bubble valueSet messages

        this.size = 0;
        this.objects = {};
        this.references = {};

        var addr = this.start;

        if(this.func.isMemberFunction){
            var obj = ThisObject.instance("this", Types.ObjectPointer.instance(funcInst.receiver));

            // Allocate object
            this.memory.allocateObject(obj, addr);
            obj.setValue(funcInst.receiver.getPointerTo());
            addr += obj.size;

            this.objects[obj.entityId] = obj;
            this.size += obj.size;
        }

        this.setUpReferenceInstances();

        // Push objects for all entities in the frame
        var autos = scope.automaticObjects;
        for (var i = 0; i < autos.length; ++i) {
            var obj = autos[i];

            // Create instance of the object
            obj = obj.objectInstance();

            // Allocate object
            this.memory.allocateObject(obj, addr);
            addr += obj.size;

            this.objects[obj.entityId] = obj;
            this.size += obj.size;
//                console.log("----" + key);
        }


        this.end = this.start + this.size;
    },

    instanceString : function(){
		var str = "";
		for(var key in this.objects){
			var obj = this.objects[key];
//			if (!obj.type){
				// str += "<span style=\"background-color:" + obj.color + "\">" + key + " = " + obj + "</span>\n";
				str += "<span>" + obj + "</span>\n";
//			}
		}
		return str;
	},

    lookup : function(entity){
        // Extra lookup will do nothing for auto objects, but will find actual
        // object for references.
        return this.objects[entity.entityId].lookup();
    },
    referenceLookup : function(entity){
        return this.references[entity.entityId].lookup();
    },
    setUpReferenceInstances : function(){
        var self = this;
        this.scope.referenceObjects.forEach(function(ref){
            self.references[ref.entityId] = ref.autoInstance();
            //self.memory.allocateObject(ref, addr);
            //addr += ref.type.size;
        });
    }

});

//var entityLookup = function (sim) {
//    var stackFrame = sim.memory.stack.topFrame();
////        var globalFrame = sim.memory.globalFrame;
//    var obj = stackFrame.lookup(this.entity);// || globalFrame.lookup(this.entity);
//    inst.setEvalValue(obj);
//}