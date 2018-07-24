import * as Types from "./types";
import { Type, ArrayType, ClassType } from "./types";
import { Observable } from "../util/observe";
import { assert } from "../util/util";
import { Memory, Value, RawValueType } from "./runtimeEnvironment";
import { RuntimeConstruct } from "./constructs";
import { Description } from "./errors";
import { AutoEntity, StaticEntity, CPPEntity, TemporaryObjectEntity } from "./entities";

abstract class ObjectData<T extends Type> {
    protected readonly object: CPPObject<T>;
    protected readonly size: number;
    protected readonly memory: Memory;
    protected readonly address: number;

    public constructor(object: CPPObject<T>, memory: Memory, address: number) {
        this.object = object;
        this.size = this.object.size;
        this.memory = memory;
        this.address = address;
    }

    public abstract rawValue() : RawValueType;

    public abstract setRawValue(newValue: RawValueType, write: boolean) : void;
};

export class AtomicObjectData extends ObjectData<Type> { // TODO: change to atomic type

    public rawValue() {
        var bytes = this.memory.readBytes(this.address, this.size);
        return this.object.type.bytesToValue(bytes);
    }

    public setRawValue(newValue: RawValueType, write: boolean) {
        this.memory.writeBytes(this.address, this.object.type.valueToBytes(newValue));
    }

}

export class ArrayObjectData extends ObjectData<ArrayType> {

    private readonly elemObjects: ArraySubobject[];

    public constructor(object: CPPObject<ArrayType>, memory: Memory, address: number) {
        super(object, memory, address);

        let subAddr = this.address;
        this.elemObjects = [];
        for(let i = 0; i < this.object.type.length; ++i){
            this.elemObjects.push(new ArraySubobject(this.object, i, memory, subAddr));
            subAddr += this.object.type.elemType.size;
        } 
    }

    public getSubobjectByAddress(address: number) {
        let index = (address - this.address) / this.object.type.elemType.size;
        return this.getArrayElemSubobject(index);
    }

    public getArrayElemSubobject(index: number) {
        if (0 <= index && index < this.elemObjects.length) {
            return this.elemObjects[index];
        }
        else {
            let outOfBoundsObj =  new ArraySubobject(this.object, index,
                this.memory, this.address + index * this.object.type.elemType.size);
            return outOfBoundsObj;
        }
    }

    public rawValue() {
        return this.elemObjects.map((elemObj) => { return elemObj.rawValue(); });
    }

    public setRawValue(newValue: RawValueType, write: boolean) {
        for(var i = 0; i < (<ArrayType>this.object.type).length; ++i){
            this.elemObjects[i].setValue(newValue[i], write);
        }
    }
}

export class ClassObjectData extends ObjectData<ClassType> {

    public readonly subobjects: Subobject[];
    public readonly baseSubobjects: BaseClassSubobject[];
    public readonly memberSubobjects: MemberSubobject[];
    private readonly memberSubobjectMap: {[index: string]: MemberSubobject} = {};

    public constructor(object: CPPObject<ClassType>, memory: Memory, address: number) {
        super(object, memory, address);
        
        let subAddr = this.address;

        this.baseSubobjects = (<ClassType>this.object.type).baseClassSubobjectEntities.map((base) => {
            let subObj = base.objectInstance(this, memory, subAddr);
            subAddr += subObj.size;
            return subObj;
        });

        this.memberSubobjects = (<ClassType>this.object.type).memberSubobjectEntities.map((mem) => {
            let subObj = mem.objectInstance(this, memory, subAddr);
            subAddr += subObj.size;
            this.memberSubobjectMap[mem.name] = subObj;
            return subObj;
        });


        this.subobjects = this.baseSubobjects.concat(this.memberSubobjects);
    }

    public getMemberSubobject(name: string) {
        return this.memberSubobjectMap[name];
    }

    // TODO: Could remove? This isn't currently used and I don't think it's useful for anything
    // public getSubobjectByAddress(address: number) {
    //     for(var i = 0; i < this.subobjects.length; ++i) {
    //         var subObj = this.subobjects[i];
    //         if (subObj.address === address){
    //             return subObj;
    //         }
    //     }
    // }

    public rawValue() {
        return this.subobjects.map((subObj) => { return subObj.rawValue(); });
    }

    public setRawValue(newValue: RawValueType, write: boolean) {
        for(var i = 0; i < this.subobjects.length; ++i) {
            this.subobjects[i].setValue(newValue[i], write);
        }
    }
}


export class CPPObject<T extends Type = Type> {  // TODO: change T to extend ObjectType

    public readonly observable = new Observable(this);

    public readonly type: T;
    public readonly size: number;

    public readonly address: number;

    public readonly data: ObjectData<Type>;

    public readonly isAlive: boolean;
    public readonly deallocatedBy?: RuntimeConstruct;


    private _isValid: boolean;

    public constructor(type: T, memory: Memory, address: number) {
        this.type = type;
        this.size = type.size;
        assert(this.size != 0, "Size cannot be 0."); // SCARY

        if (this.type instanceof ArrayType) {
            // this.isArray = true;
            this.data = new ArrayObjectData(<CPPObject<ArrayType>><CPPObject<Type>>this, memory, address);
        }
        else if (this.type instanceof ClassType) {
            this.data = new ClassObjectData(<CPPObject<ClassType>><CPPObject<Type>>this, memory, address);
        }
        else {
            this.data = new AtomicObjectData(this, memory, address);
        }

        this.address = address;
        this.isAlive = true;
        this._isValid = false;

        this.observable.send("allocated");
    }

    public subobjectValueWritten() {
        this.observable.send("valueWritten");
    }

    public toString() {
        return "@"+ this.address;
    }

    public nameString() {
        return "@" + this.address;
    }

    public deallocated(rt?: RuntimeConstruct) {
        (<boolean>this.isAlive) = false;
        this._isValid = false;
        (<RuntimeConstruct|undefined>this.deallocatedBy) = rt;
        this.observable.send("deallocated");
    }

    public getPointerTo() : Value<Types.Pointer> {
        return new Value(this.address, new Types.ObjectPointer(this));
    }

    public getValue(read: boolean = false) {
        return new Value(this.rawValue(read), this.type, this._isValid);
    }

    public rawValue(read: boolean = false) {
        let val = this.data.rawValue();
        if (read) {
            this.observable.send("valueRead", val);
        }
        return val;
    }
    
    public readValue() {
        return this.getValue(true);
    }
    
    public readRawValue() {
        return this.rawValue(true);
    }

    public setValue(newValue: Value<T>, write: boolean = false) {

        this._isValid = newValue.isValid;

        // Accept new RTTI
        (<T>this.type) = newValue.type;
        
        this.data.setRawValue(newValue.rawValue(), write);

        if(write) {
            this.observable.send("valueWritten", newValue);
        }
        
    }

    public writeValue(newValue: Value<T>) {
        this.setValue(newValue, true);
    }


    // TODO: figure out whether this old code is worth keeping
    // originally, these functions were used to notify an object when somebody else
    // messed with (i.e. read/wrote bytes that were part of the object).

    // byteRead: function(addr){
    //     if (this.isArray){
    //         // If array, find the subobject containing the byte
    //         this.elemObjects[(addr - this.address) / this.nonRefType.elemType.size].byteRead(addr);
    //     }
    //     else if (this.isClass){
    //         var ad = this.address;
    //         for(var i = 0; i < this.subobjects.length; ++i) {
    //             var mem = this.subobjects[i];
    //             if(ad = ad + mem.type.size > addr){
    //                 ad.byteRead(addr);
    //                 break;
    //             }
    //         }
    //     }
    //     else{
    //         this.send("byteRead", {addr: addr});
    //     }
    // },
    // bytesRead: function(addr, length){
    //     if (this.isArray) {
    //         var beginIndex = Math.max(0, Math.floor(( addr - this.address ) / this.nonRefType.elemType.size));
    //         var endIndex = Math.min(
    //             beginIndex + Math.ceil(length / this.nonRefType.elemType.size),
    //             this.nonRefType.length);

    //         for (var i = beginIndex; i < endIndex; ++i) {
    //             this.elemObjects[i].bytesRead(addr, length);
    //         }
    //     }
    //     else if (this.isClass){
    //         for(var i = 0; i < this.subobjects.length; ++i) {
    //             var mem = this.subobjects[i];
    //             if(addr < mem.address + mem.type.size && mem.address < addr + length){ // check for overlap
    //                 mem.bytesRead(addr, length);
    //             }
    //             else if (mem.address > addr +length){
    //                 // break if we are now in members past affected bytes
    //                 break;
    //             }
    //         }
    //     }
    //     else{
    //         this.send("bytesRead", {addr: addr, length: length});
    //     }
    // },
    // byteSet: function(addr, value){
    //     if (this.isArray){
    //         // If array, find the subobject containing the byte
    //         this.elemObjects[(addr - this.address) / this.nonRefType.elemType.size].byteSet(addr, value);
    //     }
    //     else if (this.isClass){
    //         var ad = this.address;
    //         for(var i = 0; i < this.subobjects.length; ++i) {
    //             var mem = this.subobjects[i];
    //             if(ad = ad + mem.type.size > addr){
    //                 mem.byteSet(addr, value);
    //                 break;
    //             }
    //         }
    //     }
    //     else{
    //         this.send("byteSet", {addr: addr, value: value});
    //     }
    // },
    // bytesSet: function(addr, values){
    //     var length = values.length;
    //     if (this.isArray) {
    //         var beginIndex = Math.max(0, Math.floor(( addr - this.address ) / this.nonRefType.elemType.size));
    //         var endIndex = Math.min(
    //             beginIndex + Math.ceil(length / this.nonRefType.elemType.size),
    //             this.nonRefType.length);

    //         for (var i = beginIndex; i < endIndex; ++i) {
    //             this.elemObjects[i].bytesSet(addr, values);
    //         }
    //     }
    //     else if (this.isClass){
    //         for(var i = 0; i < this.subobjects.length; ++i) {
    //             var mem = this.subobjects[i];
    //             if(addr < mem.address + mem.type.size && mem.address < addr + length){ // check for overlap
    //                 mem.bytesSet(addr, values);
    //             }
    //             else if (mem.address > addr +length){
    //                 // break if we are now in members past affected bytes
    //                 break;
    //             }
    //         }
    //     }
    //     else{
    //         this.send("bytesSet", {addr: addr, values: values});
    //     }
    // },
    // byteWritten: function(addr, value){
    //     if (this.isArray){
    //         // If array, find the subobject containing the byte
    //         this.elemObjects[(addr - this.address) / this.nonRefType.elemType.size].byteWritten(addr, value);
    //     }
    //     else if (this.isClass){
    //         var ad = this.address;
    //         for(var i = 0; i < this.subobjects.length; ++i) {
    //             var mem = this.subobjects[i];
    //             if(ad = ad + mem.type.size > addr){
    //                 mem.byteWritten(addr, value);
    //                 break;
    //             }
    //         }
    //     }
    //     else{
    //         this.send("byteWritten", {addr: addr, value: value});
    //     }
    // },
    // bytesWritten: function(addr, values){
    //     var length = values.length;
    //     if (this.isArray) {
    //         var beginIndex = Math.max(0, Math.floor(( addr - this.address ) / this.nonRefType.elemType.size));
    //         var endIndex = Math.min(
    //             beginIndex + Math.ceil(length / this.nonRefType.elemType.size),
    //             this.nonRefType.length);

    //         for (var i = beginIndex; i < endIndex; ++i) {
    //             this.elemObjects[i].bytesWritten(addr, values);
    //         }
    //     }
    //     else if (this.isClass){
    //         for(var i = 0; i < this.subobjects.length; ++i) {
    //             var mem = this.subobjects[i];
    //             if(addr < mem.address + mem.type.size && mem.address < addr + length){ // check for overlap
    //                 mem.bytesWritten(addr, values);
    //             }
    //             else if (mem.address > addr +length){
    //                 // break if we are now in members past affected bytes
    //                 break;
    //             }
    //         }
    //     }
    //     else{
    //         this.send("bytesWritten", {addr: addr, values: values});
    //     }
    // },


    public callReceived() {
        this.observable.send("callReceived", this);
    }

    public callEnded() {
        this.observable.send("callEnded", this);
    }

    // public setValidity(valid: boolean) {
    //     this._isValid = valid;
    //     this.observable.send("validitySet", valid);
    // }

    public isValueValid() {
        return this._isValid && this.type.isValueValid(this.rawValue());
    }

    public abstract describe(sim: Simulation, rtConstruct: RuntimeConstruct) : Description;

};


export class ThisObject extends CPPObject {
    

    public nameString() {
        return "this";
    }

    public describe(sim: Simulation, rtConstruct: RuntimeConstruct) {
        return {name: "this", message: "the this pointer"};
    }

}




export class StringLiteralObject extends CPPObject {

    public constructor(type: Type, memory: Memory, address: number) {
        super(type, memory, address);
    }

    public toString() {
        return "string literal at 0x" + this.address;
    }

    public nameString() {
        return "string literal at 0x" + this.address;
    }
    public describe(sim: Simulation, rtConstruct: RuntimeConstruct) {
        return {message: "string literal at 0x" + this.address};
    }
}

export class DynamicObject extends CPPObject {
    
    private hasBeenLeaked: boolean = false;

    public constructor(type: Type, memory: Memory, address: number) {
        super(type, memory, address);
    }

    public toString() {
        return "Heap object at " + this.address + " (" + this.type + ")";
    }

    public leaked(sim: Simulation) {
        if (!this.hasBeenLeaked){
            this.hasBeenLeaked = true;
            sim.memoryLeaked("Oh no! Some memory just got lost. It's highlighted in red in the memory display.")
            this.observable.send("leaked");
        }
    }

    // TODO: Why does this exist? How does something become unleaked??
    public unleaked(sim: Simulation) {
        this.observable.send("unleaked");
    }

    public describe(sim: Simulation, rtConstruct: RuntimeConstruct) {
        return {message: "the heap object " + (this.name || "at 0x" + this.address)};
    }
}



export class AutoObject extends CPPObject {

    private readonly isParameter : boolean;
    public readonly name: string;

    public constructor(autoEntity: AutoEntity, memory: Memory, address: number) {
        super(autoEntity.type, memory, address);
        this.name = autoEntity.name;
        this.isParameter = (autoEntity.declaration instanceof Declarations.Parameter);
        // this.entityId = autoObj.entityId; // TODO: is this needed?
    }

    public toString() {
        return this.name + " (" + this.type + ")";
    }

    public nameString() {
        return this.name;
    }
    
    public describe(sim: Simulation, rtConstruct: RuntimeConstruct) : Description{
        var w1 = this.isParameter ? "parameter " : "object ";
        return {name: this.name, message: "the " + w1 + this.name};
    }
}

export class StaticObject extends CPPObject {

    public readonly name: string;

    public constructor(staticEntity: StaticEntity, memory: Memory, address: number) {
        super(staticEntity.type, memory, address);
        this.name = staticEntity.name;
    }

    public toString() {
        return this.name + " (" + this.type + ")";
    }
    
    public nameString() {
        return this.name;
    }
    
    public describe(sim: Simulation, rtConstruct: RuntimeConstruct) : Description{
        return {name: this.name, message: "the static object" + this.name};
    }
}




// TODO: remove this?
export var EvaluationResultRuntimeEntity = CPPObject.extend({
    _name: "EvaluationResultRuntimeEntity",
    storage: "automatic",
    init: function(type, inst){
        this.initParent(null, type);
        this.inst = inst;
    },
    instanceString : function(){
        return this.name + " (" + this.type + ")";
    },
    runtimeLookup :  function(sim: Simulation, rtConstruct: RuntimeConstruct) {
        return this.inst.evalValue.runtimeLookup(sim, inst);
    }
});


// TODO: come up with a better name?
export class AnonymousObject extends CPPObject {
    public constructor(type: Type, memory: Memory, address: number) {
        super(type, memory, address);
        this.deallocated();
    }

    public describe(sim: Simulation, rtConstruct: RuntimeConstruct) : Description{
        return {message: "an invalid object at 0x" + this.address};
    }
};


export abstract class Subobject<T extends Type> extends CPPObject<T> {

    public readonly containingObject: CPPObject;

    public constructor(containingObject: CPPObject, type: Type, memory: Memory, address: number) {
        super(type, memory, address);
        this.containingObject = containingObject;
    }

    get isAlive() {
        return this.containingObject.isAlive;
    }

    get deallocatedBy() {
        return this.containingObject.deallocatedBy;
    }
    
    public setValue(newValue: Value<T>, write: boolean = false) {
        super.setValue(newValue, write);
        if (write) {
            this.containingObject.subobjectValueWritten();
        }
    }
}



export class ArraySubobject extends Subobject {
    
    public readonly containingObject!: CPPObject<ArrayType>; // Handled by parent
    public readonly index: number;

    public constructor(arrObj: CPPObject<ArrayType>, index: number, memory: Memory, address: number) {
        super(arrObj, arrObj.type.elemType, memory, address);
        this.index = index;
    }

    // TODO: update to have name of containing object
    // public nameString() {
    //     return this.name || "@" + this.address;
    // }

    public getPointerTo() {
        return new Value(this.address, new Types.ArrayPointer(this.containingObject));
    }

    public describe(sim: Simulation, rtConstruct: RuntimeConstruct) {
        var arrDesc = this.containingObject.describe(sim, rtConstruct);
        var desc : Description = {
            message: "element " + this.index + " of " + arrDesc.message,
        };
        if (arrDesc.name){
            desc.name = arrDesc.name + "[" + this.index + "]";
        }
        return desc;
    }

}





export class TemporaryObjectInstance<T extends Type> extends CPPObject<Type> {

    private name: string;

    public constructor(tempObjEntity: TemporaryObjectEntity, memory: Memory, address: number) {
        super(tempObjEntity.type, memory, address);
        this.name = tempObjEntity.name;
        // this.entityId = tempObjEntity.entityId;
    }

    public nameString() {
        return "@" + this.address;
    }
    
    public describe(sim: Simulation, rtConstruct: RuntimeConstruct) : Description{
        return {name: this.name, message: "the temporary object" + this.name};
    }
}

export var BaseClassSubobject = Subobject.extend({
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

export var MemberSubobject = Subobject.extend({
    _name: "MemberSubobject",
    storage: "none",

    
    public readonly name: string;

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
    },
    setValue : function(newValue, write) {
        MemberSubobject._parent.setValue.apply(this, arguments);
        write && this.parent.memberSubobjectValueWritten(this);
    }
});

