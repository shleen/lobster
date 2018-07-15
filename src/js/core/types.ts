import * as Util from "util/util";
import CPPConstruct from "constructs";
import CPPError from "error";
				
var vowels = ["a", "e", "i", "o", "u"];
var isVowel = function(c){
	return vowels.indexOf(c) != -1;
};




export var TypeSpecifier = CPPConstruct.extend({
    _name: "TypeSpecifier",

    compile : function(){

        var constCount = 0;
        var volatileCount = 0;

        var specs = this.ast;

        for(var i = 0; i < specs.length; ++i){
            var spec = specs[i];
            if(spec === "const"){
                if(this.isConst) {
                    this.addNote(CPPError.type.const_once(this));
                }
                else{
                    this.isConst = true;
                }
            }
            else if(spec === "volatile"){
                if (this.volatile){
                    this.addNote(CPPError.type.volatile_once(this));
                }
                else{
                    this.volatile = true;
                }
            }
            else if (spec === "unsigned"){
                if (this.unsigned){
                    this.addNote(CPPError.type.unsigned_once(this));
                }
                else if (this.signed){
                    this.addNote(CPPError.type.signed_unsigned(this));
                }
                else{
                    this.unsigned = true;
                }
            }
            else if (spec === "signed"){
                if (this.signed){
                    this.addNote(CPPError.type.signed_once(this));
                }
                else if (this.unsigned){
                    this.addNote(CPPError.type.signed_unsigned(this));
                }
                else{
                    this.signed = true;
                }
            }
            else{ // It's a typename
                if (this.typeName){
                    this.addNote(CPPError.type.one_type(this));
                }
                else{
                    // TODO will need to look up the typename in scope to check it
                    this.typeName = spec;
                }
            }
        }

        // If we don't have a typeName by now, it means there wasn't a type specifier
        if (!this.typeName){
            this.addNote(CPPError.declaration.func.no_return_type(this));
            return;
        }

        if (this.unsigned){
            if (!this.typeName){
                this.typeName = "int";
            }
            this.addNote(CPPError.type.unsigned_not_supported(this));
        }
        if (this.signed){
            if (!this.typeName){
                this.typeName = "int";
            }
        }

        if (builtInTypes[this.typeName]){
			this.type = builtInTypes[this.typeName].instance(this.isConst, this.isVolatile);
            return;
		}

        var scopeType;
        if (scopeType = this.contextualScope.lookup(this.typeName)){
            if (isA(scopeType, TypeEntity)){
                this.type = scopeType.type.instance(this.isConst, this.isVolatile);
                return;
            }
        }

        this.type = Unknown.instance();
        this.addNote(CPPError.type.typeNotFound(this, this.typeName));
	}
});

export var userTypeNames = {};
export var builtInTypes = {};

export var defaultUserTypeNames = {
    ostream : true,
    istream : true,
    size_t : true
};

export var sameType = function(type1, type2){
    return type1 && type2 && type1.sameType(type2);
};

export var similarType = function(type1, type2){
    return type1 && type2 && type1.similarType(type2);
};

// TODO subType function is dangerous :(
export var subType = function(type1, type2){
    return isA(type1, ClassType) && isA(type2, ClassType) && type1.isDerivedFrom(type2);
};

export var covariantType = function(derived, base){
    if (sameType(derived, base)){
        return true;
    }

    var dc;
    var bc;
    if (isA(derived, Pointer) && isA(base, Pointer)){
        dc = derived.ptrTo;
        bc = base.ptrTo;
    }
    else if (isA(derived, Reference) && isA(base, Reference)){
        dc = derived.refTo;
        bc = base.refTo;
    }
    else{
        return false; // not both pointers or both references
    }

    // Must be pointers or references to class type
    if (!isA(dc, ClassType) || !isA(bc, ClassType)){
        return false;
    }

    // dc must be derived from bc
    if (!dc.isDerivedFrom(bc)){
        return false;
    }

    // Pointers/References must have the same cv-qualification
    if (derived.isConst != base.isConst || derived.isVolatile != base.isVolatile){
        return false;
    }

    // dc must have same or less cv-qualification as bc
    if (dc.isConst && !bc.isConst || dc.isVolatile && !bc.isVolatile){
        return false;
    }

    // Yay we made it!
    return true;
};

export var referenceCompatible = function(type1, type2){
    return type1 && type2 && type1.isReferenceCompatible(type2);
};

export var noRef = function(type){
    if(isA(type, Reference)){
        return type.refTo;
    }
    else{
        return type;
    }
};

export var isCvConvertible = function(t1, t2){

    // t1 and t2 must be similar
    if (!similarType(t1,t2)){ return false; }

    // Discard 0th level of cv-qualification signatures, we don't care about them.
    // (It's essentially a value semantics thing, we're making a copy so top level const doesn't matter.)
    t1 = t1.getCompoundNext();
    t2 = t2.getCompoundNext();

    // check that t2 has const everywhere that t1 does
    // also if we ever find a difference, t2 needs const everywhere leading
    // up to it (but not including) (and not including discarded 0th level).
    var t2AllConst = true;
    while(t1 && t2){ //similar so they should run out at same time
        if (t1.isConst && !t2.isConst){
            return false;
        }
        else if (!t1.isConst && t2.isConst && !t2AllConst){
            return false;
        }

        // Update allConst
        t2AllConst = t2AllConst && t2.isConst;
        t1 = t1.getCompoundNext();
        t2 = t2.getCompoundNext();
    }

    // If no violations, t1 is convertable to t2
    return true;
};

export class Type {
    _name: "Type",
    size: Class._ABSTRACT,
    isObjectType : true,
    isArithmeticType : false,
    isIntegralType : false,
    isFloatingPointType : false,

    /**
     * Used in parenthesization of string representations of types.
     * e.g. Array types have precedence 2, whereas Pointer types have precedence 1.
     */
    i_precedence : Class._ABSTRACT,

    i_maxSize : 0,
    i_isComplete: false,


    setMaxSize : function(newMax) {
        this.i_maxSize = newMax;
    },

    getMaxSize : function() {
        return this.i_maxSize;
    },

    init: function (isConst, isVolatile) {
        if (this.size > Type.getMaxSize()){
            Type.setMaxSize(this.size);
        }
        this.isConst = isConst || false;
        // TODO ignore volatile completely? for now (and perhaps forever lol)
        this.isVolatile = false;// isVolatile || false;
    },

    getCVString : function() {
        return (this.isConst ? "const " : "") + (this.isVolatile ? "volatile " : "");
    },

    instanceString: function(){
        return this.typeString(false, "");
    },


    /**
     * Returns true if other represents exactly the same type as this, including cv-qualifications.
     * @param {Type} other
     * @returns {Boolean}
     */
    sameType : Class._ABSTRACT,

    /**
     * Returns true if other represents the same type as this, ignoring cv-qualifications.
     * @param {Type} other
     * @returns {Boolean}
     */
    similarType : Class._ABSTRACT,


    /**
     * Returns true if this type is reference-related (see C++ standard) to the type other.
     * @param {Type} other
     * @returns {boolean}
     */
    isReferenceRelated : function(other){
        return sameType(this.cvUnqualified(), other.cvUnqualified()) ||
            subType(this.cvUnqualified(),other.cvUnqualified());
    },

    /**
     * Returns true if this type is reference-compatible (see C++ standard) to the type other.
     * @param {Type} other
     * @returns {boolean}
     */
    isReferenceCompatible : function(other){
        return this.isReferenceRelated(other) && other && (other.isConst || !this.isConst) && (other.isVolatile || !this.isVolatile);

    },

    /**
     * Returns a C++ styled string representation of this type.
     * @param {boolean} excludeBase If true, exclude the base type.
     * @param {String} varname The name of the variable. May be the empty string.
     * @param {boolean} decorated If true, html tags will be added.
     * @returns {String}
     */
    typeString : Class._ABSTRACT,

    /**
     * Returns a C++ styled string representation of this type, with the base type excluded as
     * would be suitable for only printing the declarator part of a declaration.
     * @param {String} varname The name of the variable. May be the empty string.
     * @returns {String}
     */
    declaratorString : function(varname){
        return this.typeString(true, varname);
    },

    /**
     * Returns a string representing a type as it might be read verbally in english.
     * e.g. int const * var[5] --> "an array of 5 pointers to const int"
     * @param {boolean} plural Whether the returned string should be plural.
     * @returns {String}
     */
    englishString : Class._ABSTRACT,

    /**
     * Helper function for functions that create string representations of types.
     */
    i_parenthesize : function(outside, str){
        return this.i_precedence < outside.i_precedence ? "(" + str + ")" : str;
    },

    /**
     * Returns a human-readable string representation of the given raw value for this Type.
     * This is the representation that might be displayed to the user when inspecting the
     * value of an object.
     * Note that the value representation for the type in Lobster is just a javascript
     * value. It is not the C++ value representation for the type.
     * @param {Value} value
     * @returns {String}
     */
    valueToString : Class._ABSTRACT,

    /**
     * Returns the string representation of the given raw value for this Type that would be
     * printed to an ostream.
     * Note that the raw value representation for the type in Lobster is just a javascript
     * value. It is not the C++ value representation for the type.
     * Note: This is a hack that may eventually be removed since printing to a stream should
     * really be handled by overloaded << operator functions.
     * @param {Value} value
     * @returns {String}
     */
    valueToOstreamString : function(value){
        return this.valueToString(value);
    },

    /**
     * Both the name and message are just a C++ styled string representation of the type.
     * @returns {{name: {String}, message: {String}}}
     */
    describe : function(){
        var str = this.typeString(false, "");
        return {name: str, message: str};
    },

    /**
     * Converts a sequence of bytes (i.e. the C++ object representation) of a value of
     * this type into the raw value used to represent it internally in Lobster (i.e. a javascript value).
     * TODO: Right now, the hack that is used is that the whole value
     * @param bytes
     * @returns {*}
     */
    bytesToValue : function(bytes){
        // HACK: the whole value is stored in the first byte
        return bytes[0];
    },

    /**
     * Converts a raw value representing a value of this type to a sequence of bytes
     * (i.e. the C++ object representation)
     * @param {*} value
     * @returns {Array}
     */
    valueToBytes : function(value){
        var bytes = [];
        // HACK: store the whole value in the first byte and zero out the rest. thanks javascript :)
        bytes[0] = value;
        for(var i = 1; i < this.size-1; ++i){
            bytes.push(0);
        }
        return bytes;
    },

    /**
     * Returns whether a given raw value for this type is valid. For example, a pointer type may track runtime
     * type information about the array from which it was originally derived. If the pointer value increases such
     * that it wanders over the end of that array, its value becomes invalid.
     * @param {*} value
     * @returns {boolean}
     */
    isValueValid : function(value){
        return true;
    },

    /**
     * Returns whether a given raw value for this type is dereferenceable. For most types, this function just returns
     * false since dereferencing them doesn't even make sense. For pointer types, the given raw value is dereferenceable
     * if the result of the dereference will be a live object. An example of the distinction between validity and
     * dereferenceability for pointer types would be an array pointer. The pointer value (an address) is dereferenceable
     * if it is within the bounds of the array. It is valid in those same locations plus also the location one space
     * past the end (but not dereferenceable there). All other address values are invalid.
     * @param value
     * @returns {*|boolean}
     */
    isValueDereferenceable : function(value) {
        return this.isValueValid(value);
    },

    /**
     * Returns whether or not the type is complete. Note a type may be incomplete at one point during compilation
     * and then completed later. e.g. a class type is incomplete until its definition is finished
     * @returns {boolean}
     */
    isComplete : function(){
        return !!this._isComplete;
    },

    /**
     * If this is a compound type, returns the "next" type.
     * e.g. if this is a pointer-to-int, returns int
     * e.g. if this ia a reference to pointer-to-int, returns int
     * e.g. if this is an array of bool, returns bool
     * @returns {null | Type}
     */
    getCompoundNext : function() {
        return null;
    },

    /**
     * Returns true if this type is either const or volatile (or both)
     * @returns {boolean}
     */
    isCVQualified : function() {
        return this.isConst || this.isVolatile;
    },

    /**
     * Returns a cv-unqualified proxy object for this type, unless this type was already cv-unqualified,
     * in which case just returns this object.
     * @returns {Type}
     */
    cvUnqualified : function(){
        if (!this.isCVQualified()){
            return this;
        }
        else{
            return this.proxy({
                isConst: false,
                isVolatile: false
            }, false);
        }
    },

    /**
     * Returns a proxy object for this type with the specified cv-qualifications, unless this type already matches
     * the given cv-qualifications, in which case just returns this object.
     * @returns {Type}
     */
    cvQualified : function(isConst, isVolatile){
        if (this.isConst == isConst && this.isVolatile == isVolatile){
            return this;
        }
        else{
            return this.proxy({
                isConst: isConst,
                isVolatile: isVolatile
            }, false);
        }
    }
};

export var SimpleType = Type.extend({
    _name: "SimpleType",
    i_precedence: 0,
    _isComplete: true,

    /**
     * Subclasses must implement a concrete i_type property that should be a
     * string indicating the kind of type e.g. "int", "double", "bool", etc.
     */
    i_type: Class._ABSTRACT,

    sameType : function(other){
        return other && other.isA(SimpleType)
            && other.i_type === this.i_type
            && other.isConst === this.isConst
            && other.isVolatile === this.isVolatile;
    },
    similarType : function(other){
        return other && other.isA(SimpleType)
            && other.i_type === this.i_type;
    },

	typeString : function(excludeBase, varname, decorated){
        if (excludeBase) {
            return varname ? varname : "";
        }
        else{
            return this.getCVString() + (decorated ? Util.htmlDecoratedType(this.i_type) : this.i_type) + (varname ? " " + varname : "");
        }
	},
	englishString : function(plural){
		// no recursive calls to this.i_type.englishString() here
		// because this.i_type is just a string representing the type
        var word = this.getCVString() + this.i_type;
		return (plural ? this.i_type+"s" : (isVowel(word.charAt(0)) ? "an " : "a ") + word);
	},
	valueToString : function(value){
		return ""+value;
	}
});

/**
 * Used when a compilation error causes an unknown type.
 */
export var Unknown = SimpleType.extend({
    _name: "UnknownType",
    i_type: "unknown",
    isObjectType: false,
    size: 4
});
builtInTypes["unknown"] = Unknown;

export var Void = SimpleType.extend({
    _name: "Void",
    i_type: "void",
    isObjectType: false,
    isComplete: false,
    size: 0
});
builtInTypes["void"] = Void;

var _Universal_data = SimpleType.extend({
    _name: "_Universal_data",
    i_type: "_universal_data",
    size: 16
});
builtInTypes["_universal_data"] = _Universal_data;

var IntegralTypeBase = SimpleType.extend({
    _name: "IntegralTypeBase",
    isIntegralType: true,
    isArithmeticType: true,

    init: function(isConst, isVolatile) {
        this.initParent(isConst, isVolatile);
    }
});


export var Char = IntegralTypeBase.extend({
    _name: "Char",
    i_type: "char",
    size: 1,

    NULL_CHAR : 0,

    isNullChar : function(value) {
        return value === this.NULL_CHAR;
    },

    jsStringToNullTerminatedCharArray : function(str) {
        var chars = str.split("").map(function(c){
            return c.charCodeAt(0);
        });
        chars.push(Char.NULL_CHAR);
        return chars;
    },

    valueToString : function(value){
        return "'" + Util.unescapeString(String.fromCharCode(value)) + "'";//""+value;
    },
    valueToOstreamString : function(value){
        return String.fromCharCode(value);
    }
});
builtInTypes["char"] = Char;

export var Int = IntegralTypeBase.extend({
    _name: "Int",
    i_type: "int",
    size: 4
});
builtInTypes["int"] = Int;

export var Size_t = IntegralTypeBase.extend({
    _name: "Size_t",
    i_type: "size_t",
    size: 8
});
builtInTypes["size_t"] = Size_t;

export var Bool = IntegralTypeBase.extend({
    _name: "Bool",
    i_type: "bool",
    size: 1,

    bytesToValue : function(bytes){
        return (bytes[0] ? true : false);
    },

    valueToOstreamString : function(value) {
        return value ? "1" : "0";
    }
    //valueToString : function(value){
    //    return value ? "T" : "F";
    //}
});
builtInTypes["bool"] = Bool;

export var Enum = IntegralTypeBase.extend({
    _name: "Enum",
    size: 4,
    extend: function(){

        var sub = SimpleType.extend.apply(this, arguments);
        assert(sub.values);
        sub.valueMap = {};
        for(var i = 0; i < sub.values.length; ++i) {
            sub.valueMap[sub.values[i]] = i;
        }

        return sub;
    },
    valueToString : function(value){
        return this.values[value];
    }
});



var FloatingPointBase = SimpleType.extend({
    _name: "FloatingPointBase",
    isFloatingPointType: true,
    isArithmeticType: true,

    valueToString : function(value){
        var str = ""+value;
        return str.indexOf(".") != -1 ? str : str + ".";
    }

});

export var Float = FloatingPointBase.extend({
    _name: "Float",
    i_type: "float",
    size: 4
});
builtInTypes["float"] = Float;

export var Double = FloatingPointBase.extend({
    _name: "Double",
    i_type: "double",
    size: 8
});
builtInTypes["double"] = Double;







// builtInTypes["string"] =
//     StringType = SimpleType.extend({
//     _name: "String",
//     i_type: "string",
//     size: 4,
//     defaultValue: "",
//
//     valueToString : function(value){
//         value = value.replace(/\n/g,"\\n");
//         return '"' + value + '"';
//     },
//     valueToOstreamString : function(value){
//         return value;
//     },
//     bytesToValue : function(bytes){
//         return ""+bytes[0];
//     }
// });







export var OStream = SimpleType.extend({
    _name: "OStream",
    i_type: "ostream",
    size: 4,

    valueToString : function(value){
        return JSON.stringify(value);
    }
});
builtInTypes["ostream"] = OStream;

export var IStream = SimpleType.extend({
    _name: "IStream",
    i_type: "istream",
    size: 4,

    valueToString : function(value){
        return JSON.stringify(value);
    }
});
builtInTypes["istream"] = IStream;







// REQUIRES: ptrTo must be a type
export var Pointer = Type.extend({
    _name: "Pointer",
    size: 8,
    i_precedence: 1,
    _isComplete: true,

    isNull : function(value){
        return value === 0;
    },
    isNegative : function(value){
        return value < 0;
    },

    init: function(ptrTo, isConst, isVolatile){
        this.initParent(isConst, isVolatile);
        this.ptrTo = ptrTo;
        this.funcPtr = isA(this.ptrTo, FunctionType);
        return this;
    },
    getCompoundNext : function() {
        return this.ptrTo;
    },
    sameType : function(other){
        return other && other.isA(Pointer)
            && this.ptrTo.sameType(other.ptrTo)
            && other.isConst === this.isConst
            && other.isVolatile === this.isVolatile;
    },
    similarType : function(other){
        return other && other.isA(Pointer)
            && this.ptrTo.similarType(other.ptrTo);
    },
    typeString : function(excludeBase, varname, decorated){
        return this.ptrTo.typeString(excludeBase, this.i_parenthesize(this.ptrTo, this.getCVString() + "*" + varname), decorated);
    },
    englishString : function(plural){
        return (plural ? this.getCVString()+"pointers to" : "a " +this.getCVString()+"pointer to") + " " + this.ptrTo.englishString();
    },
    valueToString : function(value){
        if (isA(this.ptrTo, FunctionType) && value) {
            return value.name;
        }
        else{
            return "0x" + value;
        }
    },
    isObjectPointer : function() {
        return this.ptrTo.isObjectType || isA(this.ptrTo, Void);
    },
    isValueDereferenceable : function(value) {
        return this.isValueValid(value);
    }
});

export var ArrayPointer = Pointer.extend({
    _name: "ArrayPointer",
    size: 8,

    init: function(arrObj, isConst, isVolatile){
        this.initParent(arrObj.type.elemType, isConst, isVolatile);
        this.arrObj = arrObj;
    },
    getArrayObject : function(){
        return this.arrObj;
    },
    valueToString : function(value){
        return "0x" + value;
    },
    min : function(){
        return this.arrObj.address;
    },
    onePast : function(){
        return this.arrObj.address + this.arrObj.type.properSize;
    },
    isValueValid : function(value){
        if (!this.arrObj.isAlive()){
            return false;
        }
        var arrObj = this.arrObj;
        return arrObj.address <= value && value <= arrObj.address + arrObj.type.properSize;
    },
    isValueDereferenceable : function(value) {
        return this.isValueValid(value) && value !== this.onePast();
    },
    toIndex : function(addr){
        return Util.integerDivision(addr - this.arrObj.address, this.arrObj.type.elemType.size);
    }

});

export var ObjectPointer = Pointer.extend({
    _name: "ObjectPointer",

    init: function(obj, isConst, isVolatile){
        this.initParent(obj.type, isConst, isVolatile);
        this.obj = obj;
    },
    getPointedObject : function(){
        return this.obj;
    },
    valueToString : function(value){
        //if (this.obj.name){
        //    return "0x" + value;
        //}
        //else{
            return "0x" + value;
        //}
    },
    isValueValid : function(value){
        return this.obj.isAlive() && this.obj.address === value;
    }

});


// REQUIRES: refTo must be a type
export var Reference = Type.extend({
    _name: "Reference",
    isObjectType: false,
    i_precedence: 1,
    _isComplete: true,

    init: function(refTo, isConst, isVolatile){
        // References have no notion of const (they can't be re-bound anyway)
        this.initParent(false, isVolatile);
        this.refTo = refTo;
        this.size = this.refTo.size;
        return this;
    },

    getCompoundNext : function() {
        return this.refTo;
    },

    sameType : function(other){
        return other && other.isA(Reference) && this.refTo.sameType(other.refTo);
    },
    //Note: I don't think similar types even make sense with references. See spec 4.4
    similarType : function(other){
        return other && other.isA(Reference) && this.refTo.similarType(other.refTo);
    },
    typeString : function(excludeBase, varname, decorated){
		return this.refTo.typeString(excludeBase, this.i_parenthesize(this.refTo, this.getCVString() + "&" + varname), decorated);
	},
	englishString : function(plural){
		return this.getCVString() + (plural ? "references to" : "a reference to") + " " + this.refTo.englishString();
	},
	valueToString : function(value){
		return ""+value;
	}
});


// REQUIRES: elemType must be a type
var ArrayType = Type.extend({
    _name: "Array",
    i_precedence: 2,
    _isComplete: true, // Assume complete. If length is unknown, individual Array types will set to false
    init: function(elemType, length, isConst, isVolatile){

        if (length === undefined){
            this._isComplete = false;
        }

        // Set size before initParent since that assumes size is what it should be when it runs
        this.properSize = elemType.size * length;
        this.size = Math.max(1, this.properSize);

        this.initParent(elemType.isConst, elemType.isVolatile);
        this.elemType = elemType;
        this.length = length;
        return this;
    },

    getCompoundNext : function() {
        return this.elemType;
    },

    setLength : function(length){
        this.length = length;
        this.properSize = this.elemType.size * length;
        this.size = Math.max(1, this.properSize);
        if (this.size > Type.getMaxSize()){
            Type.setMaxSize(this.size);
        }
    },
    sameType : function(other){
        return other && other.isA(ArrayType) && this.elemType.sameType(other.elemType) && this.length === other.length;
    },
    similarType : function(other){
        return other && other.isA(ArrayType) && this.elemType.similarType(other.elemType) && this.length === other.length;
    },
    typeString : function(excludeBase, varname, decorated){
		return this.elemType.typeString(excludeBase, varname +  "["+(this.length !== undefined ? this.length : "")+"]", decorated);
	},
	englishString : function(plural){
		return (plural ? "arrays of " : "an array of ") + this.length + " " + this.elemType.englishString(this.length > 1);
	},
	valueToString : function(value){
		return ""+value;
	},
    bytesToValue : function(bytes){
        var arr = [];
        var elemSize = this.elemType.size;
        for(var i = 0; i < bytes.length; i += elemSize){
            arr.push(this.elemType.bytesToValue(bytes.slice(i, i + elemSize)));
        }
        return arr;
    },
    valueToBytes : function(value){
        var bytes = [];
        for(var i = 0; i < value.length; ++i){
            bytes.pushAll(this.elemType.valueToBytes(value[i]));
        }
        return bytes;
    }
});
export {ArrayType as Array};


/**
 * memberEntities - an array of all member entities. does not inlcude constructors, destructor, or base class subobject entities
 * subobjectEntities - an array containing all subobject entities, include base class subobjects and member subobjects
 * baseClassSubobjectEntities - an array containing entities for any base class subobjects
 * memberSubobjectEntities - an array containing entities for member subobjects (does not contain base class subobjects)
 * constructors - an array of the constructor entities for this class. may be empty if no constructors
 * copyConstructor - the copy constructor entity for this class. might be null if doesn't have a copy constructor
 * destructor - the destructor entity for this class. might be null if doesn't have a destructor
 */
var ClassType = Type.extend({
    _name: "Class",
    i_precedence: 0,
    className: Class._ABSTRACT,
    _nextClassId: 0,

    createClassType : function(name, parentScope, base, members) {
        assert(this == ClassType); // shouldn't be called on instances
        var classType = this.extend({
            _name : name,
            i_classId : this._nextClassId++,
            i_isComplete : false,
            className : name,
            size : 1,
            i_reallyZeroSize : true,
            classScope : ClassScope.instance(name, parentScope, base && base.classScope),
            memberEntities : [],
            subobjectEntities : [],
            baseClassSubobjectEntities : [],
            memberSubobjectEntities : [],
            constructors : [],
            copyConstructor : null,
            destructor : null,

            i_baseClass : base || null // TODO: change if we ever want multiple inheritance


        });

        if (base){
            classType.addBaseClass(base);
        }


        members && members.forEach(classType.addMember.bind(classType));

        // var fakeDecl = FakeDeclaration.instance("numDucklings", Int.instance());
        // classType.addMember(MemberSubobjectEntity.instance(fakeDecl, classType));

        return classType;
    },

    addBaseClass : function(base) {
        this.baseClassSubobjectEntities.push(BaseClassSubobjectEntity.instance(base, this, "public"));
        this.subobjectEntities.push();
        this.size += base.size;
    },

    getBaseClass : function() {
        if (this.baseClassSubobjectEntities.length > 0) {
            return this.baseClassSubobjectEntities[0].type;
        }
        else {
            return null;
        }
    },

    memberLookup : function(memberName, options) {
        return this.classScope.memberLookup(memberName, options);
    },

    requiredMemberLookup : function(memberName, options) {
        return this.classScope.requiredMemberLookup(memberName, options);
    },

    hasMember : function(memberName, options) {
        return !!this.memberLookup(memberName, options);
    },

    addMember : function(mem){
        assert(this._isClass);
        this.classScope.addDeclaredEntity(mem);
        this.memberEntities.push(mem);
        if(mem.type.isObjectType){
            if (this.i_reallyZeroSize){
                this.size = 0;
                delete this.i_reallyZeroSize;
            }
            mem.memberIndex = this.memberSubobjectEntities.length;
            this.memberSubobjectEntities.push(mem);
            this.subobjectEntities.push(mem);
            this.size += mem.type.size;
        }
    },

    addConstructor : function(constructor){
        this.constructors.push(constructor);
    },

    addDestructor : function(destructor){
        this.destructor = destructor;
    },

    getDefaultConstructor : function(){
        return this.classScope.singleLookup(this.className+"\0", {
            own:true, noBase:true, exactMatch:true,
            paramTypes:[]});
    },

    getCopyConstructor : function(requireConst){
        return this.classScope.singleLookup(this.className+"\0", {
                own:true, noBase:true, exactMatch:true,
                paramTypes:[Reference.instance(this.instance(true))]}) ||
            !requireConst &&
            this.classScope.singleLookup(this.className+"\0", {
                own:true, noBase:true, exactMatch:true,
                paramTypes:[Reference.instance(this.instance(false))]});
    },

    getAssignmentOperator : function(requireConst, isThisConst){
        return this.classScope.singleLookup("operator=", {
                own:true, noBase:true, exactMatch:true,
                paramTypes:[this.instance()]}) ||
            this.classScope.singleLookup("operator=", {
                own:true, noBase:true, exactMatch:true,
                paramTypes:[Reference.instance(this.instance(true))]}) ||
            !requireConst &&
            this.classScope.singleLookup("operator=", {
                own:true, noBase:true, exactMatch:true,
                paramTypes:[Reference.instance(this.instance(false))]})

    },

    makeComplete : function() {
        this.i_isComplete = true;
    },

    isComplete : function(){
        return this.i_isComplete || this.i_isTemporarilyComplete;
    },
    setTemporarilyComplete : function(){
        this.i_isTemporarilyComplete = true;
    },
    unsetTemporarilyComplete : function(){
        delete this.i_isTemporarilyComplete;
    },


    // TODO: I think this is fragile dependent on order of compilation of translation units
    merge : function(class1, class2) {
        class1.i_classId = class2.i_classId = Math.min(class1.i_classId, class2.i_classId);
    },

    classString : function(){
        return this.className;
    },

    // Functions that may be called on either the class or the instance

    isDerivedFrom : function(potentialBase){
        var b = this.getBaseClass();
        while(b){
            if (similarType(potentialBase, b)){
                return true;
            }
            b = b.base;
        }
        return false;
    },


    // Below this are instance-only functions

    isInstanceOf : function(other) {
        return this.i_classId === other.i_classId;
    },

    sameType : function(other){
        //alert(other && other.isA(this._class));
        return this.similarType(other)
            && other.isConst === this.isConst
            && other.isVolatile === this.isVolatile;
    },

    similarType : function(other){
        //alert(other && other.isA(this._class));
        return other && other.isA(ClassType) && other.i_classId === this.i_classId;
    },
    typeString : function(excludeBase, varname, decorated){
        if (excludeBase) {
            return varname ? varname : "";
        }
        else{
            return this.getCVString() + (decorated ? Util.htmlDecoratedType(this.className) : this.className) + (varname ? " " + varname : "");
        }
    },
    englishString : function(plural){
        // no recursive calls to this.type.englishString() here
        // because this.type is just a string representing the type
        return this.getCVString() + (plural ? this.className+"s" : (isVowel(this.className.charAt(0)) ? "an " : "a ") + this.className);
    },
    valueToString : function(value){
        return JSON.stringify(value, null, 2);
    },
    bytesToValue : function(bytes){
        var val = {};
        var b = 0;
        for(var i = 0; i < this.memberSubobjectEntities.length; ++i) {
            var mem = this.memberSubobjectEntities[i];
            val[mem.name] = mem.type.bytesToValue(bytes.slice(b, b + mem.type.size));
            b += mem.type.size;
        }
        return val;
    },
    valueToBytes : function(value){
        var bytes = [];
        for(var i = 0; i < this.memberSubobjectEntities.length; ++i) {
            var mem = this.memberSubobjectEntities[i];
            bytes.pushAll(mem.type.valueToBytes(value[mem.name]));
        }
        return bytes;
    }

});
export {ClassType as Class};



// REQUIRES: returnType must be a type
//           argTypes must be an array of types
var FunctionType = Type.extend({
    _name: "Function",
    isObjectType: false,
    i_precedence: 2,
    size: 0,
    init: function(returnType, paramTypes, isConst, isVolatile, isThisConst){
        this.initParent(isConst, isVolatile);

        if (isThisConst){
            this.isThisConst = true;
        }
        // Top-level const on return type is ignored for non-class types
        // (It's a value semantics thing.)
        // TODO not for poitners/refrences
        if(!(isA(returnType, ClassType) || isA(returnType, Pointer) || isA(returnType, Reference))){
            this.returnType = returnType.cvUnqualified();
        }
        else{
            this.returnType = returnType;
        }

        this.paramTypes = paramTypes.map(function(ptype){
            return isA(ptype, ClassType) ? ptype : ptype.cvUnqualified();
        });
        // Top-level const on parameter types is ignored for non-class types



        this.isFunction = true;

        this.paramStrType = "(";
        for (var i = 0; i < paramTypes.length; ++i){
            this.paramStrType += (i == 0 ? "" : ",") + paramTypes[i];
        }
        this.paramStrType += ")";

        this.paramStrEnglish = "(";
        for (var i = 0; i < paramTypes.length; ++i){
            this.paramStrEnglish += (i == 0 ? "" : ", ") + paramTypes[i].englishString();
        }
        this.paramStrEnglish += ")";
        return this;
    },
    sameType : function(other){
        if (!other){
            return false;
        }
        if (!other.isA(FunctionType)){
            return false;
        }
        if (!this.sameReturnType(other)){
            return false;
        }
        if (!this.sameParamTypes(other)){
            return false;
        }
        return true;
    },
    similarType : function(other){
        return this.sameType(other);
    },
    sameParamTypes : function(other){
        if (isA(other, FunctionType)){
            return this.sameParamTypes(other.paramTypes);
        }
        if (this.paramTypes.length !== other.length){
            return false;
        }
        for(var i = 0; i < this.paramTypes.length; ++i){
            if (!this.paramTypes[i].sameType(other[i])){
                return false;
            }
        }
        return true;
    },
    sameReturnType : function(other){
        return this.returnType.sameType(other.returnType);
    },
    sameSignature : function(other){
        return this.isThisConst === other.isThisConst && this.sameParamTypes(other);
    },
    typeString : function(excludeBase, varname, decorated){
		return this.returnType.typeString(excludeBase, varname + this.paramStrType, decorated);
	},

    englishString : function(plural){
		return (plural ? "functions that take " : "a function that takes ") + this.paramStrEnglish + " " +
			   (plural ? "and return " : "and returns ") + this.returnType.englishString();
	},
	valueToString : function(value){
		return ""+value;
	}
});
export {FunctionType as Function};