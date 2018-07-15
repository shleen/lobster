import { assert } from "../util/util";
import { Observable } from "../util/observe";
import { CPPObject } from "./objects";
import { Type, Bool, Char, ObjectPointer, ArrayPointer } from "./types";
import last from "lodash/last";

type RawValueType = number | string | boolean;

export class Value {
    private static _name = "Value";

    public readonly type: Type;
    public readonly isValid: boolean;

    public readonly rawValue: RawValueType;


    // TODO: ts: change any type for value to match type expected for CPP type of value
    constructor(rawValue: RawValueType, type: Type, isValid: boolean = true) {
        // TODO: remove this.value in favor of using rawValue() function
        this.rawValue = rawValue;
        this.type = type;
        this.isValid = isValid && this.type.isValueValid(this.rawValue);
    };

    public clone(valueToClone: RawValueType = this.rawValue) {
        return new Value(valueToClone, this.type, this.isValid);
    }

    public equals(otherValue: Value) {
        return new Value(
            this.rawValue === otherValue.rawValue,
            Bool.instance(),
            this.isValid && otherValue.isValid);
    }

    public rawEquals(otherRawValue: any) {
        return this.rawValue === otherRawValue;
    }

    public toString() {
        return this.valueString();
    }

    public valueString() {
        return this.type.valueToString(this.rawValue);
    }

    // TODO: perhaps this should be moved to the ostream class
    public valueToOstreamString() {
        return this.type.valueToOstreamString(this.rawValue);
    }

    /**
     * This should be used VERY RARELY. The only time to use it is if you have a temporary Value instance
     * that you're using locally and want to keep updating its raw value to something else before passing
     * to something like memory.dereference(). For example, this is done when traversing through a cstring by
     * getting the value of the pointer initially, then ad hoc updating that value as you move through the cstring.
     */
    public setRawValue(rawValue: RawValueType) {
        (<RawValueType>this.rawValue) = rawValue;
        (<boolean>this.isValid) = this.isValid && this.type.isValueValid(this.rawValue);
    }

    public describe() {
        return { message: this.valueString() };
    }
}



var createAnonymousObject = function (type: Type, memory: Memory, address: number) {
    var obj = new AnonObject(type);
    obj.allocated(memory, address);
    return obj;
};

export class Memory {
    private static _name = "Memory";

    public readonly observable = new Observable(this);

    public readonly capacity: number;
    public readonly staticCapacity: number;
    public readonly stackCapacity: number;
    public readonly heapCapacity: number;

    public readonly staticStart: number;
    public readonly staticEnd: number;

    public readonly stackStart: number;
    public readonly stackEnd: number;

    public readonly heapStart: number;
    public readonly heapEnd: number;

    public readonly temporaryStart: number;
    public readonly temporaryCapacity: number;
    public readonly temporaryEnd: number;

    // Definite assignment assertions with ! are for properties initialized in the reset function called
    // at the end of the constructor.
    private bytes!: RawValueType[]; //TODO: Hack - instead of real bytes, memory just stores the raw value in the first byte of an object
    private objects!: { [index: number]: CPPObject };
    private stringLiteralMap!: { [index: string]: StringLiteralObject };
    private staticObjects!: { [index: string]: CPPObject };
    private temporaryObjects!: { [index: number]: TemporaryObject };
    private stack!: MemoryStack;
    private heap!: MemoryHeap;

    private staticTop!: number;
    private temporaryBottom!: number;

    constructor(capacity: number, staticCapacity: number, stackCapacity: number) {
        this.capacity = capacity || 10000;
        this.staticCapacity = staticCapacity || Math.floor(this.capacity / 10);
        this.stackCapacity = stackCapacity || Math.floor((this.capacity - this.staticCapacity) / 2);
        this.heapCapacity = this.capacity - this.staticCapacity - this.stackCapacity;

        this.staticStart = 0;
        this.staticEnd = this.staticStart + this.staticCapacity;

        this.stackStart = this.staticEnd;
        this.stackEnd = this.stackStart + this.stackCapacity;

        this.heapStart = this.stackEnd;
        this.heapEnd = this.heapStart + this.heapCapacity;

        this.temporaryStart = this.heapEnd + 100;
        this.temporaryCapacity = 10000;
        this.temporaryEnd = this.temporaryStart + this.temporaryCapacity;

        assert(this.staticCapacity < this.capacity && this.stackCapacity < this.capacity && this.heapCapacity < this.capacity);
        assert(this.heapEnd == this.capacity);

        this.reset();
    }

    public reset() {

        // memory is a sequence of bytes, addresses starting at 0
        this.bytes = new Array(this.capacity + this.temporaryCapacity);
        for (var i = 0; i < this.capacity + this.temporaryCapacity; ++i) {
            this.bytes[i] = Math.floor(Math.random() * 100);
        }

        this.objects = {};
        this.stringLiteralMap = {};
        this.staticTop = this.staticStart + 4;
        this.staticObjects = {};
        this.temporaryBottom = this.temporaryStart;

        this.stack = MemoryStack.instance(this, this.staticEnd);
        this.heap = MemoryHeap.instance(this, this.heapEnd);
        this.temporaryObjects = {};
        this.observable.send("reset");
    }

    public getByte(addr: number) {
        return this.bytes[addr];
    }

    public readByte(addr: number, fromObj: CPPObject) {

        // Notify any other object that is interested in that byte
        // var begin = ad - Type.getMaxSize();
        //for(var i = ad; begin < i; --i){
        //    var obj = this.objects[i];
        //    if (obj == fromObj) { continue; }
        //    if (obj && obj.size > ad - i){
        //        obj.byteRead(ad);
        //    }
        //}
        return this.bytes[addr];
    }

    public getBytes(addr: number, num: number) {
        return this.bytes.slice(addr, addr + num);
    }

    public readBytes(addr: number, num: number, fromObj: CPPObject) {
        var end = addr + num;

        // Notify any other object that is interested in that byte
        // var begin = ad - Type.getMaxSize();
        //for(var i = end-1; begin < i; --i){
        //    var obj = this.objects[i];
        //    if (obj == fromObj) { continue; }
        //    if (obj && obj.size > ad - i){
        //        obj.bytesRead(ad, end-ad);//.send("bytesRead", {addr: ad, length: end-ad});
        //    }
        //}

        return this.bytes.slice(addr, end);
    }

    public setByte(addr: number, value: RawValueType) {
        this.bytes[addr] = value;

        // Notify any object that is interested in that byte
        // var begin = ad - Type.getMaxSize();
        //for(var i = ad; begin < i; --i){
        //    var obj = this.objects[i];
        //    if (obj && obj.size > ad - i){
        //        obj.byteSet(ad, value);//.send("byteSet", {addr: ad, value: value});
        //    }
        //}
    }

    public writeByte(addr: number, value: RawValueType, fromObj: CPPObject) {
        this.bytes[addr] = value;

        // Notify any other object that is interested in that byte
        // var begin = ad - Type.getMaxSize();
        //for(var i = ad; begin < i; --i){
        //    var obj = this.objects[i];
        //    if (obj == fromObj) { continue; }
        //    if (obj && obj.size > ad - i){
        //        obj.byteWritten(ad, value);//.send("byteWritten", {addr: ad, value: value});
        //    }
        //}
    }

    public setBytes(addr: number, values: RawValueType[]) {

        for (var i = 0; i < values.length; ++i) {
            this.bytes[addr + i] = values[i];
        }

        // Notify any other object that is interested in that byte
        //var begin = ad - Type.getMaxSize();
        //for(var i = ad+values.length; begin < i; --i){
        //    var obj = this.objects[i];
        //    if (obj && obj.size > ad - i){
        //        obj.bytesSet(ad, values);//.send("byteSet", {addr: ad, values: values});
        //    }
        //}
    }

    public writeBytes(addr: number, values: RawValueType[], fromObj: CPPObject) {

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

        for (var i = 0; i < values.length; ++i) {
            this.bytes[addr + i] = values[i];
        }

        // Notify any other object that is interested in that byte
        //var begin = ad - Type.getMaxSize();
        //for(var i = ad+values.length-1; begin < i; --i){
        //    var obj = this.objects[i];
        //    if (obj == fromObj) { continue; }
        //    if (obj && obj.size > ad - i){
        //        obj.bytesWritten(ad, values);//.send("bytesWritten", {addr: ad, values: values});
        //    }
        //}
    }

    // Attempts to dereference a pointer and retreive the object it points to.
    // Takes in a Value or CPPObject of pointer type. Must point to an object type.
    // Returns the most recently allocated object at the given address.
    // This may be an object which is no longer alive (has been deallocated).
    // If no object is found, or an object of a type that does not match the pointed-to type is found,
    // returns an anonymous object representing the given address interpreted as the requested type.
    // (In C++, reading/writing to this object will cause undefined behavior.)
    dereference(ptr: Value | CPPObject) {
        assert(ptr.type.isObjectPointer());

        var addr = ptr.rawValue();

        // Handle special cases for pointers with RTTI
        if (ptr.type instanceof ArrayPointer) {
            return ptr.type.arrObj.getSubobject(addr);

        }
        if (ptr.type instanceof ObjectPointer && ptr.type.isValueValid(addr)) {
            return ptr.type.obj;
        }

        // Grab object from memory
        var obj = this.objects[addr];

        if (obj && (similarType(obj.type, type) || subType(obj.type, type))) {
            return obj;
        }

        // If the object wasn't there or doesn't match the type we asked for (ignoring const)
        // then we need to create an anonymous object of the appropriate type instead
        return createAnonymousObject(type, this, addr);
    }
    

    public allocateObject(object: CPPObject, addr: number) {
        this.objects[addr] = object;
        object.allocated(this, addr);
    }

    /**
     * Deallocates an object at the given address. The object actually remains in memory, but is marked as dead.
     * If no object exists at the given address, does nothing. If the object is already dead, does nothing.
     * @param addr 
     * @param killer The runtime construct that killed the object
     */
    public deallocateObject(addr: number, killer?: RuntimeConstruct) {
        var obj = this.objects[addr];
        if (obj && obj.isAlive) {
            obj.deallocated(killer);
        }
    }

    public allocateStringLiteral(stringLiteralEntity: StringLiteralEntity) {
        var str = stringLiteralEntity.str;
        if (!this.stringLiteralMap[str]) {
            // only need to allocate a string literal object if we didn't already have an identical one
            var object = stringLiteralEntity.objectInstance();
            this.allocateObject(object, this.staticTop);

            // record the string literal in case we see more that are the same in the future
            this.stringLiteralMap[str] = object;

            // write value of string literal into the object
            object.writeValue(Char.jsStringToNullTerminatedCharArray(str));

            // adjust location for next static object
            this.staticTop += object.size;
        }

    }

    public getStringLiteral(str: string) {
        return this.stringLiteralMap[str];
    }

    public allocateStatic(staticEntity: StaticEntity) {
        var object = staticEntity.objectInstance();
        this.allocateObject(object, this.staticTop);
        this.staticTop += object.size;
        this.staticObjects[staticEntity.getFullyQualifiedName()] = object;

        // TODO: Consider removing this? I think it's used in some hacks, but it's not semantically correct
        if (staticEntity.defaultValue !== undefined) {
            object.setValue(staticEntity.defaultValue);
        }
        else if (staticEntity.type.defaultValue !== undefined) {
            object.setValue(staticEntity.type.defaultValue);
        }
    }

    

    public staticLookup(staticEntity: StaticEntity) {
        return this.staticObjects[staticEntity.getFullyQualifiedName()];
    }

    public allocateTemporaryObject(tempEntity: TemporaryObjectEntity) {
        var obj = new TemporaryObjectInstance(tempEntity);
        this.allocateObject(obj, this.temporaryBottom);
        this.temporaryBottom += tempEntity.type.size;
        this.temporaryObjects[tempEntity.entityId] = obj;
        this.observable.send("temporaryObjectAllocated", obj);

        // TODO: Consider removing this? I think it's used in some hacks, but it's not semantically correct
        if (tempEntity.defaultValue !== undefined) {
            obj.setValue(tempEntity.defaultValue);
        }
        else if (tempEntity.type.defaultValue !== undefined) {
            obj.setValue(tempEntity.type.defaultValue);
        }

        return obj;
    }


    // TODO: think of some way to prevent accidentally calling the other deallocate directly with a temporary obj
    public deallocateTemporaryObject(obj: TemporaryObjectInstance, killer?: RuntimeConstruct) {
        this.deallocateObject(obj, killer);
        //this.temporaryBottom += obj.type.size;
        delete this.temporaryObjects[obj];
        this.observable.send("temporaryObjectDeallocated", obj);
    }
};

class MemoryStack {
    private static readonly _name =  "MemoryStack";
    
    public readonly observable = new Observable(this);

    private top: number;
    private readonly start: number;
    private readonly memory: Memory;
    private readonly frames: MemoryFrame[];

    constructor(memory: Memory, start: number) {
        this.memory = memory;
        this.start = start;
        this.top = start;
        this.frames = [];
    }

    // public clear() {
    //     this.frames.length = 0;
    //     this.top = this.start;
    // }

    public topFrame() {
        return last(this.frames);
    }

    public pushFrame(rtFunc: RuntimeFunction) {
        var frame = MemoryFrame.instance(rtFunc.model.bodyScope, this.memory, this.top, rtFunc);
        this.top += frame.size;
        this.frames.push(frame);
        this.memory.observable.send("framePushed", frame);
        return frame;
    }

    public popFrame(rtConstruct: RuntimeConstruct) {
        var frame = this.frames.pop();
        for (var key in frame.objects) {
            var obj = frame.objects[key];
            this.memory.deallocateObject(obj.address, rtConstruct)
        }
        this.top -= frame.size;
        this.memory.observable.send("framePopped", frame);
    }

    public toString() {
        var str = "<ul class=\"stackFrames\">";
        for (var i = 0; i < this.frames.length; ++i) {
            var frame = this.frames[i];
            str += "<li>" + frame.toString() + "</li>";
        }
        str += "</ul>";
        return str;
    }
}

class MemoryHeap {
    private static readonly _name = "MemoryHeap";

    public readonly observable = new Observable(this);

    private bottom: number;
    private readonly end: number;
    private readonly memory: Memory;
    private readonly objectMap: {[index:number]: DynamicObject};

    public constructor(memory: Memory, end: number) {
        this.memory = memory;
        this.end = end;
        this.bottom = end;
        this.objectMap = {};
    }

    // public clear() {
    //     this.objectMap = {};
    // }

    public allocateNewObject(obj: DynamicObject) {
        this.bottom -= obj.type.size;
        this.memory.allocateObject(obj, this.bottom);
        this.objectMap[obj.address] = obj;
        this.memory.observable.send("heapObjectAllocated", obj);

        // TODO: Consider removing this? I think it's used in some hacks, but it's not semantically correct
        if (obj.defaultValue !== undefined) {
            obj.setValue(obj.defaultValue);
        }
        else if (obj.type.defaultValue !== undefined) {
            obj.setValue(obj.type.defaultValue);
        }
    }

    public deleteObject(addr: number, rtConstruct: RuntimeConstruct) {
        var obj = this.objectMap[addr];
        if (obj) {
            delete this.objectMap[addr];
            this.memory.deallocateObject(addr, rtConstruct);
            this.memory.observable.send("heapObjectDeleted", obj);
            // Note: responsibility for running destructor lies elsewhere
        }
        return obj;
    }
}


class MemoryFrame {
    private static readonly _name = "MemoryFrame";
    
    public readonly observable = new Observable(this);

    public readonly scope: Scope;
    private readonly start: number;
    private readonly end: number;
    private readonly memory: Memory;
    private readonly func: RuntimeFunction;

    private size: number;
    private readonly localObjectsByEntityId: {[index:number]: AutoObject};
    private readonly localReferencesByEntityId: {[index:number]: ReferenceEntityInstance};
    

    public constructor(scope: Scope, memory: Memory, start: number, rtFunc: RuntimeFunction) {
        var self = this;
        this.scope = scope;
        this.memory = memory;
        this.start = start;
        this.func = rtFunc;

        this.size = 0;
        this.localObjectsByEntityId = {};
        this.localReferencesByEntityId = {};

        var addr = this.start;

        if (this.func.model.isMemberFunction) {
            var obj = new ThisObject("this", Types.ObjectPointer.instance(rtFunc.getReceiver()));

            // Allocate object
            this.memory.allocateObject(obj, addr);
            obj.setValue(rtFunc.getReceiver().getPointerTo());
            addr += obj.size;

            this.localObjectsByEntityId[obj.entityId] = obj;
            this.size += obj.size;
        }

        this.setUpReferenceInstances();

        // Push objects for all entities in the frame
        var autos = scope.automaticObjects;
        for (var i = 0; i < autos.length; ++i) {
            var objEntity = autos[i];

            // Create instance of the object
            obj = objEntity.objectInstance();

            // Allocate object
            this.memory.allocateObject(obj, addr);
            addr += obj.size;

            this.localObjectsByEntityId[obj.entityId] = obj;
            this.size += obj.size;

            if (objEntity.defaultValue !== undefined) {
                obj.setValue(objEntity.defaultValue);
            }
            else if (objEntity.type.defaultValue !== undefined) {
                obj.setValue(objEntity.type.defaultValue);
            }
            //                console.log("----" + key);
        }


        this.end = this.start + this.size;
    }

    public toString() {
        var str = "";
        for (var key in this.localObjectsByEntityId) {
            var obj = this.localObjectsByEntityId[key];
            //			if (!obj.type){
            // str += "<span style=\"background-color:" + obj.color + "\">" + key + " = " + obj + "</span>\n";
            str += "<span>" + obj + "</span>\n";
            //			}
        }
        return str;
    }

    public getObjectForEntity(entity: AutoEntity) {
        return this.localObjectsByEntityId[entity.entityId];
    }
    public referenceLookup(entity: AutoEntity) {
        return this.localReferencesByEntityId[entity.entityId].runtimeLookup();
    }
    public setUpReferenceInstances() {
        var self = this;
        this.scope.referenceObjects.forEach(function (ref: ReferenceEntity) {
            self.localReferencesByEntityId[ref.entityId] = ref.runtimeInstance();
            //self.memory.allocateObject(ref, addr);
            //addr += ref.type.size;
        });
    }

};