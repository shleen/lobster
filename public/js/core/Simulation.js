/**
 * @author James
 */

var Lobster = Lobster || {};
Lobster.CPP = Lobster.CPP || {};

var IDLE_MS_BEFORE_COMPILE = 1000;

var Simulation = Lobster.CPP.Simulation = DataPath.extend({
    _name: "Simulation",

    MAX_SPEED: -13445, // lol

    init: function(program){
        this.initParent();

        this.speed = Simulation.MAX_SPEED;

        this.program = program;

        // These things need be reset when the simulation is reset
        this.memory = Memory.instance();
        this.console = ValueEntity.instance("console", "");
        this.i_execStack = [];
        this.i_pendingNews = [];
        this.i_leakCheckIndex = 0;


        if (this.program.mainEntity() && !this.program.hasSemanticErrors()){
            this.start();
        }
    },

    clear : function(){
    },

    stepsTaken : function() {
        return this.i_stepsTaken;
    },

	start : function(){
        this.i_paused = true;
		this.i_stepsTaken = 0;
        this.seedRandom("random seed");

        this.send("cleared");
        this.i_execStack.clear();
        this.console.setValue("");

		this.memory.reset();

        this.i_pendingNews = [];
        this.i_leakCheckIndex = 0;

        // TODO NEW move compilation of mainCall to program?
        var mainCall = FunctionCall.instance(null, {isMainCall:true});
        mainCall.compile(this.program.globalScope, this.program.mainEntity(), []);
        this.i_mainCallInst = mainCall.createAndPushInstance(this, null);

        for(var i = this.program.staticEntities.length - 1; i >= 0; --i){
            this.memory.allocateStatic(this.program.staticEntities[i]);
        }
        var anyStaticInits = false;
        for(var i = this.program.staticEntities.length - 1; i >= 0; --i){

            var init = this.program.staticEntities[i].getInitializer();
            if(init) {
                init.createAndPushInstance(this, this.i_mainCallInst);
                anyStaticInits = true;
            }
        }

        this.i_atEnd = false;
        this.send("started");

        // Needed for whatever is first on the execution stack
        this.upNext();

        // Get through all static initializers and stuff before main
        if (anyStaticInits){
            this.i_mainCallInst.setPauseWhenUpNext();
            this.i_paused = false;
            while (!this.i_paused){
                this.stepForward();
                this.i_stepsTaken = 0; // TODO remove hack. make outlet count user steps
            }
            this.i_paused = false;
        }

        this.i_stepsTaken = 0; // this is needed here as well since stepForward right below may spawn some instances that capture stepsTaken from simulation
        this.stepForward(); // To call main
        this.i_stepsTaken = 0;

	},
	
	push : function(codeInstance){
		this.i_execStack.push(codeInstance);
		codeInstance.pushed(this);
		this.send("pushed", codeInstance, this);
	},

    popUntil : function(inst){
        while(this.i_execStack.length > 0 && this.i_execStack.last() !== inst){
            this.pop();
        }
    },
	
	// REQUIRES: query is either a string indicating a stackType
	//           or an instance on the stack.
	pop : function(query, returnArray){
		if (query){
			var poppedArr = [];
			var popped;
			while (this.i_execStack.length > 0){
				popped = this.i_execStack.pop();
				popped.popped(this);
                if (isA(popped.model, Statements.Statement) || isA(popped.model, FunctionDefinition)){
                    this.leakCheck();
                }

				poppedArr.push(popped);
				var current = (typeof query == "string" ? popped.stackType : popped);
				if (current == query){
					break;
				}
			}
			return (returnArray ? poppedArr : popped);
		}
		else{
			var popped = this.i_execStack.pop();
            popped.popped(this);
            if (isA(popped.model, Statements.Statement) || isA(popped.model, FunctionDefinition)){
                this.leakCheck();
            }
			return popped;
		}
	},
	
	peek : function(query, returnArray, offset){
        if (this.i_execStack.length === 0){
            return null;
        }
		offset = offset || 0;
		if (query){
			var peekedArr = [];
			var peeked;
			for (var i = this.i_execStack.length - 1 - offset; i >= 0; --i){
				peeked = this.i_execStack[i];
				peekedArr.unshift(peeked);
                if (typeof query === "function"){
                    if (query(peeked)){
                        break;
                    }
                }
                else{
                    var current = (typeof query == "string" ? peeked.stackType : peeked);
                    if (current == query){
                        break;
                    }
                }
			}
			return (returnArray ? peekedArr : peeked);
		}
		else{
			return this.i_execStack.last();
		}
	},
	
	peeks : function(query, returnArray){
		var results = [];
		var offset = 0;
		while (offset < this.i_execStack.length){
			var p = this.peek(query, true, offset);
			offset += p.length;
			results.unshift(returnArray ? p : p[0]);
		}
		return results;
	},

    clearRunThread: function(){
        if (this.runThread){
            this.runThreadClearedFlag = true;
            clearTimeout(this.runThread);
            this.runThread = null;
        }
    },

    startRunThread: function(func){
        this.runThread = setTimeout(func, 0);
    },

    autoRun : function(options){
        options = options || {};

        // Clear old thread
        this.clearRunThread();

        this.i_paused = false;

        var self = this;
        var func = function(){

            // Try to complete this.speed number of steps in 10ms.
            var startTime = Date.now();
            for(var num = 0; self.speed === Simulation.MAX_SPEED || num < self.speed; ++num){

                // Did we finish?
                if (self.i_atEnd){
                    self.send("finished");
                    options.onFinish && options.onFinish();
                    options.after && options.after();
                    return; // do not renew timeout
                }

                // Did we pause?
                if (self.i_paused || (options.pauseIf && options.pauseIf(self))){
                    self.send("paused");
                    options.onPause && options.onPause();
                    options.after && options.after();
                    return; // do not renew timeout
                }

                // Abort if we run out of time
                if (Date.now() - startTime >= (self.speed === Simulation.MAX_SPEED ? 10 : 100) ){
                    break; // will renew timeout
                }

                self.stepForward();
            }

            // Renew timeout
            if (self.speed === Simulation.MAX_SPEED){
                self.runThread = setTimeout(func, 0);
            }
            else{
                self.runThread = setTimeout(func, Math.max(0,100-(Date.now() - startTime)));
            }

        };

        // Start timeout
        this.startRunThread(func);
    },

    stepOver: function(options){
        var target = this.peek(function(inst){
            return isA(inst.model, Initializer) || isA(inst.model, Expressions.FunctionCallExpr) || !isA(inst.model, Expressions.Expression);
        });

        if (target) {
            this.autoRun(copyMixin(options, {
                pauseIf: function(){
                    return target.hasBeenPopped;
                }
            }));
        }
        else{
            this.stepForward();
            options.after && options.after();
        }
    },

    stepOut: function(options){
        var target = this.i_execStack.last().executionContext();

        if (target) {
            this.autoRun(copyMixin(options, {
                pauseIf: function(){
                    return target.hasBeenPopped;
                }
            }));
        }
        else{
            this.stepForward();
            options.after && options.after();
        }
    },

	stepForward : function(n){
        n = n || 1;

        for(var i = 0; !this.i_atEnd && i < n; ++i){
            this._stepForward();
        }

        this.send("afterFullStep", this.i_execStack.length > 0 && this.i_execStack.last());
	},

    _stepForward : function(){
        if(this.i_execStack.length > 0) {
            ++this.i_stepsTaken;
        }

        // Loop indefinitely until we find something that counts as a "step"
        var keepGoing = true;
        while(keepGoing){
            if (this.i_execStack.length > 0){
                // There are things to do, pop top instance
                var inst = this.i_execStack.last();

                // Call stepForward on inst, if returns truthy value it means keep going
                this.send("beforeStepForward", {inst: inst});
                keepGoing = inst.stepForward(this);
                this.send("afterStepForward", {inst: inst, keepGoing: keepGoing});

                // After each step call upNext
                this.upNext();
            }
            else{
                // We're done
                this.atEnded();
                break;
            }
        }
    },

	stepBackward : function(n){
        if (n === 0){
            return;
        }
        n = n || 1;
		$.fx.off = true;
		Outlets.CPP.CPP_ANIMATIONS = false; // TODO not sure I need this
        this.i_alertsOff = true;
        this.i_explainOff = true;
        $("body").addClass("noTransitions").height(); // .height() is to force reflow
        //CPPCodeInstance.silent = true;
		if (this.i_stepsTaken > 0){
			this.clear();
			var steps = this.i_stepsTaken-n;
			this.start();
			for(var i = 0; i < steps; ++i){
                this.stepForward();
			}
		}
        //CPPCodeInstance.silent = false;
        $("body").removeClass("noTransitions").height(); // .height() is to force reflow
        this.i_alertsOff = false;
        this.i_explainOff = false;
        Outlets.CPP.CPP_ANIMATIONS = true;
		$.fx.off = false;

	},
	
	upNext : function(){
        var inst = false;
		while(this.i_execStack.length > 0){
            if (this.i_execStack.last() === inst){
                break;
            }
            inst = this.i_execStack.last();
//            debug("calling upNext for " + inst.instanceString(), "Simulation");
            this.send("beforeUpNext", {inst: inst});
            var skip = inst.upNext(this);
            //this.explain(inst.explain());
            //debug(this.i_execStack.map(function(elem){return elem.model._name + ", " + elem.index;}).join("\n"), "execStack");
            this.send("afterUpNext", {inst: inst, skip: skip});

            if(!skip){
                break;
            }
		// else if (this.stmtStack.length > 0){
			// this.stmtStack.last().upNext(this);
		// }
		// else if (this.controlStack.length > 0){
			// this.controlStack.last().upNext(this);
		// }
		// else if (this.callStack.length > 0){
			// this.callStack.last().upNext(this);
		// }
		}
	},
    cout : function(value){
        if(isA(value.type, Types.Pointer) && isA(value.type.ptrTo, Types.Char)){
            var text = "";
            var addr = value.value;
            var c = this.memory.bytes[addr];
            while (c){
                text += Types.Char.coutString(c);
                c = this.memory.bytes[++addr];
            }
        }
        else{
            var text = escapeString(value.coutString());
        }
        this.console.setValue(this.console.value() + text);
    },
    cin : function(object){
        object.value = 4;
    },
    alert : function(message){
        if (!this.i_alertsOff){
            this.send("alert", message);
        }
    },
    crash : function(message){
        this.alert(message + "\n\n (Note: This is a nasty error and I may not be able to recover. Continue at your own risk.)");
    },
    explain : function(exp){
        //alert(exp.ignore);
        if (!this.i_explainOff){
            if (!exp.ignore) {
                this.send("explain", exp.message);
            }
        }
    },
    closeMessage : function(){
        this.send("closeMessage");
    },
    pause : function(){
        this.i_paused = true;
    },

    seedRandom : function(seed){
        Math.seedrandom(""+seed);
    },

    nextRandom : function(){
        return Math.random();
    },

    mainCallInstance : function(){
        return this.i_mainCallInst;
    },

    leakCheckChildren : function(obj){


        // If it's a pointer into an array, hypothetically we can get to anything else in the array,
        // so we need to add the whole thing to the frontier.
        // This also covers dynamic arrays - we never have a pointer to the array, but to elements in it.
        if (isA(obj.type, Types.ArrayPointer)){
            return [obj.type.arrObj];
        }
        else if (isA(obj.type, Types.Pointer)){
            var pointsTo = this.memory.getObject(obj);
            if (pointsTo && !isA(pointsTo, AnonObject)){
                return [pointsTo];
            }
        }
        else if (isA(obj.type, Types.Array)){
            return obj.elemObjects;
            //children.push(obj.elemObjects);
            //var elems = obj.rawValue();
            //var children = [];
            //for(var i = 0; i < elems.length; ++i){
            //    children.push(Value.instance(elems[i], obj.type.elemType));
            //}
            //return children;
        }
        else if (isA(obj.type, Types.Class)){
            return obj.subobjects;
            //var members = obj.subObjects;
            //var children = [];
            //for(var i = 0; i < members.length; ++i){
            //    children.push(Value.instance(elems[i]));
            //}
            //return children;
        }
        return [];
    },
    leakCheck : function(){
        //console.log("leak check running!");
        // Temporary place for testing leak check
        var heapObjectsMap = this.memory.heap.objectMap;
        for (var addr in heapObjectsMap) {
            var obj = heapObjectsMap[addr];
            if(this.leakCheckObj(obj)){
                obj.leaked(this);
            }
            else{
                obj.unleaked(this);
            }
        }
    },
    leakCheckObj : function(query) {
        ++this.i_leakCheckIndex;
        var frontier = [];
        for (var key in this.globalScope.entities) {
            var ent = this.globalScope.entities[key];
            if (isA(ent, ObjectEntity)){
                ent.i_leakCheckIndex = this.i_leakCheckIndex;
                frontier.push(ent);
            }
        }

        for(var i = 0; i < this.memory.stack.frames.length; ++i){
            var frameObjs = this.memory.stack.frames[i].objects;
            for (var key in frameObjs) {
                var ent = frameObjs[key];
                if (isA(ent, ObjectEntity)){
                    ent.i_leakCheckIndex = this.i_leakCheckIndex;
                    frontier.push(ent);
                }
            }
        }

        for(var i = 0; i < this.i_pendingNews.length; ++i){
            var obj = this.i_pendingNews[i];
            obj.i_leakCheckIndex = this.i_leakCheckIndex;
            frontier.push(obj);
        }

        for(var i = 0; i < this.i_execStack.length; ++i){
            var inst = this.i_execStack[i];
            var obj = inst.evalValue || (inst.func && inst.func.returnValue);
            if (obj && isA(obj, ObjectEntity)){
                obj.i_leakCheckIndex = this.i_leakCheckIndex;
                frontier.push(obj);
            }
            else if (obj && isA(obj, Value)){
                frontier.push(obj);
            }
        }

        for (var key in this.memory.temporaryObjects){
            var obj = this.memory.temporaryObjects[key];
            obj.i_leakCheckIndex = this.i_leakCheckIndex;
            frontier.push(obj);
        }

        while (frontier.length > 0) {
            var obj = frontier.shift();

            // Check if found
            if (obj === query){
                return false;
            }

            // Mark as visited
            obj.i_leakCheckIndex = this.i_leakCheckIndex;
            var children = this.leakCheckChildren(obj);
            for(var i = 0; i < children.length; ++i){
                var child = children[i];
                if (child.i_leakCheckIndex !== this.i_leakCheckIndex){
                    frontier.push(child);
                }
            }
        }
        return true;
    },
    atEnded : function(){
        this.i_atEnd = true;
        this.send("atEnded");
        //console.log("done!");
    },
    act : {
        sourceCode : "codeSet"
    }
});