import { FunctionType, VoidType, PeelReference, CompleteObjectType, ReferenceType, AtomicType, CompleteClassType, CompleteReturnType, PotentiallyCompleteObjectType, ReferredType } from "./types";
import { RuntimeConstruct } from "./constructs";
import { CompiledFunctionDefinition } from "./declarations";
import { MemoryFrame, Value } from "./runtimeEnvironment";
import { CPPObject } from "./objects";
import { RuntimeBlock, createRuntimeStatement } from "./statements";
import { Simulation } from "./Simulation";
import { Mutable, assert } from "../util/util";
import { LocalObjectEntity, LocalReferenceEntity } from "./entities";
import { RuntimeCtorInitializer } from "./initializers";
import { RuntimeFunctionCall } from "./FunctionCall";
import { RuntimeObjectDeallocator } from "./ObjectDeallocator";

enum RuntimeFunctionIndices {

}

export class RuntimeFunction<T extends FunctionType<CompleteReturnType> = FunctionType<CompleteReturnType>> extends RuntimeConstruct<CompiledFunctionDefinition<T>> {

    public readonly caller?: RuntimeFunctionCall;
    // public readonly containingRuntimeFunction: this;

    public readonly stackFrame?: MemoryFrame;

    public readonly receiver?: CPPObject<CompleteClassType>;

    /**
     * The object returned by the function, either an original returned-by-reference or a temporary
     * object created to hold a return-by-value. Once the function call has been executed, will be
     * defined unless it's a void function.
     */
    public readonly returnObject?: T extends FunctionType<infer RT> ? (
        RT extends VoidType ? undefined : 
        RT extends CompleteObjectType ? CPPObject<RT> :
        RT extends ReferenceType<CompleteObjectType> ? CPPObject<ReferredType<RT>> : never
        ): never;
        // T extends FunctionType<VoidType> ? undefined :
        // T extends FunctionType<ReferenceType<CompleteObjectType>> ? CPPObject<ReferredType<T["returnType"]>> :
        // T extends (FunctionType<AtomicType> | FunctionType<CompleteClassType>) ? CPPObject<T["returnType"]> :
        // T extends FunctionType<infer T> ? 
        // never; // includese FunctionType<ReferenceType<IncompleteObjectType>> - that should never be created at runtime

    public readonly hasControl: boolean = false;

    public readonly ctorInitializer?: RuntimeCtorInitializer;
    public readonly body: RuntimeBlock;

    /**
     * Only defined for destructors. A runtime deallocator for the member
     * variables of the receiver that is set as the cleanup construct for
     * this RuntimeFunction.
     */
    public readonly memberDeallocator?: RuntimeObjectDeallocator;

    public constructor(model: CompiledFunctionDefinition<T>, sim: Simulation, caller: RuntimeFunctionCall | null, receiver?: CPPObject<CompleteClassType>) {
        super(model, "function", caller || sim);
        if (caller) { this.caller = caller };
        this.receiver = receiver;
        // A function is its own containing function context
        this.setContainingRuntimeFunction(this);
        this.ctorInitializer = model.ctorInitializer?.createRuntimeCtorInitializer(this);
        this.body = createRuntimeStatement(model.body, this);

        if (model.memberDeallocator) {
            this.memberDeallocator = model.memberDeallocator.createRuntimeConstruct(this);
            this.setCleanupConstruct(this.memberDeallocator);
        }
    }


    // setCaller : function(caller) {
    //     this.i_caller = caller;
    // },

    public pushStackFrame() {
        (<Mutable<this>>this).stackFrame = this.sim.memory.stack.pushFrame(this);
    }

    public popStackFrame() {
        this.sim.memory.stack.popFrame(this);
    }

    /**
     * Sets the return object for this function. May only be invoked once.
     * e.g.
     *  - return-by-value: The caller should set the return object to a temporary object, whose value
     *                     may be initialized by a return statement.
     *  - return-by-reference: When the function is finished, is set to the object returned.
     */
    public setReturnObject<T extends FunctionType<AtomicType | CompleteClassType>>(this: RuntimeFunction<T>, obj: CPPObject<T["returnType"]>) : void;
    public setReturnObject<T extends ReferenceType<CompleteObjectType>>(this: RuntimeFunction<FunctionType<T>>, obj: CPPObject<ReferredType<T>>) : void;
    public setReturnObject(obj: CPPObject) {
        // This should only be used once
        assert(!this.returnObject);
        (<Mutable<this>>this).returnObject = <this["returnObject"]>obj;

    }

    public getParameterObject(num: number) {
        let param = this.model.parameters[num].declaredEntity;
        assert(param?.variableKind === "object", "Can't look up an object for a reference parameter.");
        assert(this.stackFrame);
        return this.stackFrame.localObjectLookup(param);
    }

    // TODO: apparently this is not used?
    // public initializeParameterObject(num: number, value: Value<AtomicType>) {
    //     let param = this.model.parameters[num].declaredEntity;
    //     assert(param instanceof LocalObjectEntity, "Can't look up an object for a reference parameter.");
    //     assert(this.stackFrame);
    //     assert(param.type.isAtomicType());
    //     this.stackFrame.initializeLocalObject(<LocalObjectEntity<AtomicType>>param, <Value<AtomicType>>value);
    // }

    public bindReferenceParameter(num: number, obj: CPPObject) {
        let param = this.model.parameters[num].declaredEntity;
        assert(param instanceof LocalReferenceEntity, "Can't bind an object parameter like a reference.");
        assert(this.stackFrame);
        return this.stackFrame.bindLocalReference(param, obj);
    }

    public gainControl() {
        (<boolean>this.hasControl) = true;
        this.observable.send("gainControl");
    }

    public loseControl() {
        (<boolean>this.hasControl) = true;
        this.observable.send("loseControl");
    }

    // private encounterReturnStatement : function() {
    //     this.i_returnStatementEncountered = true;
    // },

    // returnStatementEncountered : function() {
    //     return this.i_returnStatementEncountered;
    // }


    // tailCallReset : function(sim: Simulation, rtConstruct: RuntimeConstruct, caller) {

    //     // Need to unseat all reference that were on the stack frame for the function.
    //     // Otherwise, lookup weirdness can occur because the reference lookup code wasn't
    //     // intended to be able to reseat references and parameter initializers will instead
    //     // think they're supposed to pass into the things that the references on the existing
    //     // stack frame were referring to.
    //     inst.stackFrame.setUpReferenceInstances();

    //     inst.reusedFrame = true;
    //     inst.setCaller(caller);
    //     inst.index = this.initIndex;
    //     sim.popUntil(inst);
    //     //inst.send("reset"); // don't need i think
    //     return inst;
    // },

    protected stepForwardImpl(): void {
            this.popStackFrame();
            this.startCleanup();
    }

    protected upNextImpl(): void {
        if (this.ctorInitializer && !this.ctorInitializer.isDone) {
            this.sim.push(this.ctorInitializer);
        }
        else if (!this.body.isDone) {
            this.sim.push(this.body);
        }
    }

    // upNext : function(sim: Simulation, rtConstruct: RuntimeConstruct){
    // }

    // stepForward : function(sim: Simulation, rtConstruct: RuntimeConstruct){
    //     if (inst.index === "afterDestructors"){
    //         this.done(sim, inst);
    //     }
    // }

    // done : function(sim: Simulation, rtConstruct: RuntimeConstruct){

    //     // If non-void return type, check that return object was initialized.
    //     // Non-void functions should be guaranteed to have a returnObject (even if it might be a reference)
    //     if (!isA(this.type.returnType, Types.Void) && !inst.returnStatementEncountered()){
    //         this.flowOffNonVoid(sim, inst);
    //     }

    //     if (inst.receiver){
    //         inst.receiver.callEnded();
    //     }

    //     sim.memory.stack.popFrame(inst);
    //     sim.pop(inst);
    // }

    // flowOffNonVoid : function(sim: Simulation, rtConstruct: RuntimeConstruct){
    //     if (this.isMain){
    //         inst.i_returnObject.setValue(Value.instance(0, Types.Int.instance()));
    //     }
    //     else{
    //         sim.implementationDefinedBehavior("Yikes! This is a non-void function (i.e. it's supposed to return something), but it ended without hitting a return statement");
    //     }
    // }

}

// TODO: is this needed? I think RuntimeFunction may be able to handle all of it.
// export class RuntimeMemberFunction extends RuntimeFunction {

//     public readonly receiver: CPPObject<ClassType>;

//     public constructor (model: FunctionDefinition, parent: RuntimeFunctionCall, receiver: CPPObject<ClassType>) {
//         super(model, parent);
//         this.receiver = receiver;
//     }

// }