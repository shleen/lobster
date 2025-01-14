import { PotentialParameterType, Type, CompleteObjectType, sameType, ReferenceType, BoundedArrayType, Char, ArrayElemType, FunctionType, referenceCompatible, createClassType, PotentiallyCompleteClassType, CompleteClassType, PotentiallyCompleteObjectType, PeelReference, Completed, VoidType, CompleteReturnType, PointerType, ArrayOfUnknownBoundType, PotentiallyCompleteArrayType } from "./types";
import { assert, Mutable, unescapeString, assertFalse, asMutable, assertNever } from "../util/util";
import { Observable } from "../util/observe";
import { RuntimeConstruct, isClassContext, SemanticContext } from "./constructs";
import { PotentialFullExpression, RuntimePotentialFullExpression } from "./PotentialFullExpression";
import { FunctionCall } from "./FunctionCall";
import { LocalVariableDefinition, ParameterDefinition, GlobalVariableDefinition, LinkedDefinition, FunctionDefinition, ParameterDeclaration, FunctionDeclaration, ClassDefinition, FunctionDefinitionGroup, ClassDeclaration, MemberVariableDeclaration, SimpleDeclaration, CompiledClassDefinition } from "./declarations";
import { CPPObject, AutoObject, StaticObject, StringLiteralObject, TemporaryObject, ObjectDescription, MemberSubobject, ArraySubobject, BaseSubobject, DynamicObject } from "./objects";
import { CPPError, CompilerNote } from "./errors";
import { Memory } from "./runtimeEnvironment";
import { Expression } from "./expressionBase";
import { TranslationUnit } from "./Program";
import { RuntimeFunction } from "./functions";
import { NewObjectType, RuntimeNewArrayExpression, RuntimeNewExpression } from "./new_delete";
import { QualifiedName, UnqualifiedName } from "./lexical";



interface NormalLookupOptions {
    readonly kind: "normal";
    readonly noParent?: boolean;
    readonly noBase?: boolean;
}

interface ExactLookupOptions {
    readonly kind: "exact";
    readonly noParent?: boolean;
    readonly noBase?: boolean;
    readonly paramTypes: readonly PotentialParameterType[]
    readonly receiverType?: CompleteClassType;
}

export type NameLookupOptions = NormalLookupOptions | ExactLookupOptions;


/**
 * Discriminated union over entities introduced into a scope by a declaration.
 * Discriminated by .declarationKind property.
 */
export type DeclaredEntity = VariableEntity | FunctionEntity | ClassEntity;

/**
 * Possible results of name lookup.
 */
export type DeclaredScopeEntry = VariableEntity | FunctionOverloadGroup | ClassEntity;


export class Scope {

    // private static HIDDEN = Symbol("HIDDEN");
    // private static NO_MATCH = Symbol("NO_MATCH");

    private readonly entities: { [index: string]: DeclaredScopeEntry | undefined } = {};
    private readonly hiddenClassEntities: { [index: string]: ClassEntity | undefined } = {};
    private readonly typeEntities: { [index: string]: ClassEntity | undefined } = {};

    public readonly translationUnit: TranslationUnit;
    public readonly parent?: Scope;
    public readonly name?: string;
    public readonly children: { [index: string]: NamedScope | undefined } = {};

    public constructor(translationUnit: TranslationUnit, parent?: Scope) {
        // This assertion is no longer always true due to out-of-line function definitions
        // assert(!parent || translationUnit === parent.translationUnit);
        this.translationUnit = translationUnit;
        this.parent = parent;
    }

    public addChild(child: NamedScope) {
        this.children[child.name] = child;
    }

    /** Attempts to declare a variable in this scope.
     * @param newEntity The variable being declared.
     * @returns Either the entity that was added, or an existing one already there, assuming it was compatible.
     * If an error prevents the entity being added successfully, returns the error instead. (e.g. A previous
     * declaration with the same name but a different type.)
     */
    public declareVariableEntity<EntityT extends VariableEntity>(newEntity: EntityT): EntityT | CompilerNote {
        let entityName = newEntity.name;
        let existingEntity = this.entities[entityName];

        // No previous declaration for this name
        if (!existingEntity) {
            this.variableEntityCreated(newEntity);
            return this.entities[entityName] = <any>newEntity; // HACK. <any> cast - this broke with TS 4.4.4
        }

        // If there is an existing class entity, it may be displaced and effectively hidden.
        if (existingEntity.declarationKind === "class") {
            // Note: because a class entity cannot displace another class entity, we can
            // assume that there is no hidden class entity already
            this.hiddenClassEntities[entityName] = existingEntity;
            this.variableEntityCreated(newEntity);
            return this.entities[entityName] = <any>newEntity; // HACK. <any> cast - this broke with TS 4.4.4
        }

        // Previous declaration for this name, but different kind of symbol
        if (existingEntity.declarationKind !== "variable") {
            return CPPError.declaration.symbol_mismatch(newEntity.firstDeclaration, newEntity);
        }

        // Previous declaration of variable with same name, attempt to merge
        let entityOrError = newEntity.mergeInto(existingEntity);

        // If we got the new entity back, it means it was added to the scope for the first time
        if (entityOrError === newEntity) {
            this.variableEntityCreated(newEntity);
        }

        // Cast below is based on trusting mergeInto will only ever return the
        // existing entity if the types and types of entities matched.
        return <EntityT | CompilerNote>entityOrError;
    }

    protected variableEntityCreated(newEntity: VariableEntity) {
        // Do nothing. Subclasses may choose to register entities.
        // e.g. Namespace scopes will register global object entities with linker.
    }

    /** Attempts to declare a function in this scope.
     * @param newEntity - The function being declared.
     * @returns Either the entity that was added, or an existing one already there, assuming it was compatible.
     * If an error prevents the entity being added successfully, returns the error instead. (e.g. A previous
     * function declaration with the same signature but a different return type.)
     */
    public declareFunctionEntity(newEntity: FunctionEntity) {
        let entityName = newEntity.name;
        let existingEntity = this.entities[entityName];

        // No previous declaration for this name
        if (!existingEntity) {
            this.entities[entityName] = new FunctionOverloadGroup([newEntity]);
            // this.functionEntityCreated(newEntity);
            return newEntity;
        }

        // If there is an existing class entity, it may be displaced and effectively hidden.
        if (existingEntity.declarationKind === "class") {
            // Note: because a class entity cannot displace another class entity, we can
            // assume that there is no hidden class entity already
            this.hiddenClassEntities[entityName] = existingEntity;
            this.entities[entityName] = new FunctionOverloadGroup([newEntity]);
            // this.functionEntityCreated(newEntity);
            return newEntity;
        }

        // Previous declaration for this name, but different kind of symbol
        if (!(existingEntity instanceof FunctionOverloadGroup)) {
            return CPPError.declaration.symbol_mismatch(newEntity.firstDeclaration, newEntity);
        }

        // Function overload group of previously existing functions, attempt to merge
        let entityOrError = newEntity.mergeInto(existingEntity);

        // If we got the new entity back, it means it was added to the scope for the first time
        // if (entityOrError === newEntity) {
        //     this.functionEntityCreated(newEntity);
        // }

        return entityOrError;
    }

    // protected functionEntityCreated(newEntity: FunctionEntity) {

    // }

    /** Attempts to declare a class in this scope. TODO docs: this documentation is out of date
     * @param newEntity - The class being declared.
     * @returns Either the entity that was added, or an existing one already there, assuming it was compatible.
     * If an error prevents the entity being added successfully. (e.g. An error due to
     * multiple definitions of the same class within a single translation unit.)
     */
    public declareClassEntity(newEntity: ClassEntity) {
        let entityName = newEntity.name;
        let existingEntity = this.entities[entityName];

        // No previous declaration for this name
        if (!existingEntity) {
            this.classEntityCreated(newEntity);
            return this.entities[entityName] = newEntity;
        }

        // Previous declaration for this name, but different kind of symbol
        if (!(existingEntity instanceof ClassEntity)) {
            return CPPError.declaration.symbol_mismatch(newEntity.firstDeclaration, newEntity);
        }

        // Note that we don't displace existing class entities as new variables or functions do.
        // Instead, either the new/existing class entities are compatible (i.e. they do result in
        // a multiple definition error), or they will generate an error.

        // There was a previous class declaration, attempt to merge
        let entityOrError = newEntity.mergeInto(existingEntity);

        // If we got the new entity back, it means it was added to the scope for the first time
        if (entityOrError === newEntity) {
            this.classEntityCreated(newEntity);
        }

        return entityOrError;
    }

    protected classEntityCreated(newEntity: ClassEntity) {
        // A function declaration has linkage. The linkage is presumed to be external, because Lobster does not
        // support using the static keyword or unnamed namespaces to specify internal linkage.
        // It has linkage regardless of whether this is a namespace scope or a block scope.
        newEntity.registerWithLinker();
    }

    // protected declaredEntityAdded(ent: DeclaredEntity) {

    // }

    // public singleLookup(name: string, options: NameLookupOptions) {
    //     var result = this.lookup(name, options);
    //     if (Array.isArray(result)){
    //         return result[0];
    //     }
    //     else{
    //         return result;
    //     }
    // }

    // public requiredLookup(name, options){
    //     return this.i_requiredLookupImpl(this.lookup(name, options), name, options);
    // }
    // private i_requiredLookupImpl(res, name, options) {
    //     options = options || {};
    //     if (!res){
    //         if (options.paramTypes || options.params){
    //             throw SemanticExceptions.NoMatch.instance(this, name,
    //                 options.paramTypes || options.params && options.params.map(function(p){return p.type;}),
    //                 options.isThisConst
    //             );
    //         }
    //         else{
    //             throw SemanticExceptions.NotFound.instance(this, name);
    //         }
    //     }
    //     else if(Array.isArray(res)){
    //         if (res === Scope.HIDDEN){
    //             throw SemanticExceptions.Hidden.instance(this, name,
    //                 options.paramTypes || options.params && options.params.map(function(p){return p.type;}),
    //                 options.isThisConst);
    //         }
    //         if (res.length === 0){
    //             throw SemanticExceptions.NoMatch.instance(this, name,
    //                 options.paramTypes || options.params && options.params.map(function(p){return p.type;}),
    //                 options.isThisConst
    //             );
    //         }
    //         if (res.length > 1){
    //             throw SemanticExceptions.Ambiguity.instance(this, name);
    //         }
    //         return res[0];
    //     }

    //     return res;
    // }

    /**
     * Performs unqualified name lookup of a given name in this scope. Returns the entity found, or undefined
     * if no entity can be found. Note that the entity found may be a function overload group. Lookup may
     * may search through parent scopes. The lookup process can be customized by providing a set of `NameLookupOptions` (
     * see documentation for the `NameLookupOptions` type for more details.) If the entity found is not a
     * function overload group, "normal" lookup is the same as "exact lookup" (the contextual parameter types
     * and receiver type are ignored at that point even if provided.)
     * @param name An unqualified name to be looked up.
     * @param options A set of options to customize the lookup process.
     * @returns 
     */
    public lookup(name: UnqualifiedName, options: NameLookupOptions = { kind: "normal" }): DeclaredScopeEntry | undefined {
        options = options || {};

        assert(!name.includes("::"), "Qualified name used with unqualified lookup function.");

        // Note: We do not need to check this.hiddenClassEntities here. If a class entity
        // is hidden by another entity of the same name in the same scope, the only way to
        // access it is through an elaborated type specifier
        let ent = this.entities[name];

        // If we don't have an entity in this scope and we didn't specify we
        // wanted an own entity, look in parent scope (if there is one)
        if (!ent && !options.noParent && this.parent) {
            return this.parent.lookup(name, Object.assign({}, options));
        }

        // If we didn't find anything, return undefined
        if (!ent) {
            return undefined;
        }

        if (!(ent instanceof FunctionOverloadGroup)) {
            // If it's not an function overload group, it's a single entity so return it
            return ent;
        }
        else {
            let viable = ent.overloads; // a set of potentially viable function overloads

            // If we're looking for an exact match of parameter types
            if (options.kind === "exact") {
                const paramTypes = options.paramTypes;
                const receiverType = options.receiverType;
                viable = ent.overloads.filter((cand) => {

                    // Check that parameter types match
                    if (!cand.type.sameParamTypes(paramTypes))

                        if (receiverType) {
                            // if receiver type is defined, candidate must also have
                            // a receiver and the presence/absence of const must match
                            // NOTE: the actual receiver type does not need to match, just the constness
                            return cand.type.receiverType && receiverType.isConst === cand.type.isConst;
                        }
                        else {
                            // if no receiver type is defined, candidate must not have a receiver
                            return !cand.type.receiverType;
                        }
                    return cand.type.sameParamTypes(paramTypes);
                });

                if (viable.length > 0) {
                    return new FunctionOverloadGroup(viable);
                }
                else {
                    return undefined;
                }
            }

            // // If we're looking for something that could be called with given parameter types, including conversions
            // else if (options.paramTypes) {
            //     // var params = options.params || options.paramTypes && fakeExpressionsFromTypes(options.paramTypes);
            //     viable = overloadResolution(ent, options.paramTypes, options.receiverType).viable || [];
            //     return viable[0];
            //     // TODO - should give error if there's multiple elements i.e. an ambiguity
            // }

            return new FunctionOverloadGroup(viable);

            // // If viable is empty, not found.
            // if (viable && viable.length === 0){
            //     // Check to see if we could have found it except for name hiding
            //     if (!options.own && this.parent){
            //         var couldHave = this.parent.lookup(name, options);
            //         if (couldHave && (!Array.isArray(couldHave) || couldHave.length === 1 || couldHave === Scope.HIDDEN)){
            //             if (options.noNameHiding){
            //                 return couldHave;
            //             }
            //             else{
            //                 return Scope.HIDDEN;
            //             }
            //         }
            //     }
            //     return Scope.NO_MATCH;
            // }
            // else{
            //     return viable;
            // }

        }
    }

    public availableVars() : VariableEntity[] {
        let vars : VariableEntity[] = [];
        Object.values(this.entities).forEach(
            entity => entity?.declarationKind === "variable" && vars.push(entity)
        );
        return this.parent ? vars.concat(this.parent.availableVars()) : vars;
        
    }
}

export class BlockScope extends Scope {

}


export class NamedScope extends Scope {

    public readonly name: string;

    public constructor(translationUnit: TranslationUnit, name: string, parent?: Scope) {
        super(translationUnit, parent);
        this.name = name;
        if (parent) {
            parent.addChild(this);
        }
    }
}

export class NamespaceScope extends NamedScope {

    public constructor(translationUnit: TranslationUnit, name: string, parent?: NamespaceScope) {
        super(translationUnit, name, parent);
    }

    protected variableEntityCreated(newEntity: VariableEntity) {
        super.variableEntityCreated(newEntity);
        if (newEntity instanceof GlobalObjectEntity) {
            this.translationUnit.context.program.registerGlobalObjectEntity(newEntity);
        }
    }
}

export class ClassScope extends NamedScope {

    public readonly base?: ClassScope;

    /**
     * 
     * @param translationUnit 
     * @param name The unqualified name of the class
     * @param parent 
     * @param base 
     */
    public constructor(translationUnit: TranslationUnit, name: string, parent?: Scope | ClassScope, base?: ClassScope) {
        super(translationUnit, name, parent);
        this.base = base;
    }

    public createAlternateParentProxy(newParent: Scope) {
        let proxy = Object.create(this);
        proxy.parent = newParent;
        return proxy;
    }

    protected variableEntityCreated(newEntity: VariableEntity) {
        super.variableEntityCreated(newEntity);
        // TODO: add linkage when static members are implemented
        // if (newEntity instanceof StaticMemberObjectEntity) {
        //     this.translationUnit.context.program.registerGlobalObjectEntity(newEntity);
        // }
    }

    /**
     * Performs unqualified name lookup of a given name in this class scope. The
     * behavior and customization options are similar to `lookup()` in the Scope
     * class, except that the base class scope (if it exists) will be searched
     * before parent scopes.
     * @param name An unqualified name to be looked up.
     * @param options A set of options to customize the lookup process.
     */
    public lookup(name: string, options: NameLookupOptions = { kind: "normal" }): DeclaredScopeEntry | undefined {
        let ownMember = super.lookup(name, Object.assign({}, options, {noBase: true, noParent: true}));
        if (ownMember) {
            return ownMember;
        }

        let baseMember = this.base && !options.noBase && this.base.lookup(name, Object.assign({}, options, {noParent: true}));
        if (baseMember) {
            return baseMember;
        }

        let parentMember = this.parent && !options.noParent && this.parent.lookup(name, Object.assign({}, options, {noBase: true}));
        if (parentMember) {
            return parentMember;
        }

        // returns undefined
    }

    // /**
    //  * Performs member name lookup of a given name in this class scope. Only names
    //  * declared in this scope and potentially the base class scope will be considered.
    //  * Parent scopes will not be considered. The lookup process can be customized
    //  * by providing a set of `NameLookupOptions` (see documentation for the
    //  * `NameLookupOptions` type for more details.)
    //  * @param name An unqualified name to be looked up.
    //  * @param options A set of options to customize the lookup process.
    //  */
    // public memberLookup(name: string, options: NameLookupOptions = { kind: "normal" }): DeclaredScopeEntry | undefined {
    //     let ownMember = super.lookup(name, Object.assign({}, options, {noParent: true});
    //     if (ownMember) {
    //         return ownMember;
    //     }
    //     else {
    //         return 
    //     }
    // }
}

export interface EntityDescription {
    name: string;
    message: string;
}

export type EntityID = number;

export abstract class CPPEntity<T extends Type = Type> {
    private static _nextEntityId = 0;

    public readonly observable = new Observable(this);

    public readonly entityId: number;
    public readonly type: T;


    /**
     * Most entities will have a natural type, but a few will not (e.g. namespaces). In this case,
     * I haven't decided what to do.
     * TODO: fix this - there should probably be a subtype or interface for a TypedEntity
     */
    public constructor(type: T) {
        this.entityId = CPPEntity._nextEntityId++;
        this.type = type;
    }

    public abstract isTyped<NarrowedT extends CompleteObjectType>(this: ObjectEntity, predicate: (t:Type) => t is NarrowedT) : this is ObjectEntity<NarrowedT>;
    public abstract isTyped<NarrowedT extends Type>(predicate: (t:Type) => t is NarrowedT) : this is CPPEntity<NarrowedT>;

    public abstract describe(): EntityDescription;

    // // TODO: does this belong here?
    // public isLibraryConstruct() {
    //     return false
    // }

    // // TODO: does this belong here?
    // public isLibraryUnsupported() {
    //     return false;
    // }

    //TODO: function for isOdrUsed()?

    public isSemanticallyEquivalent(other: CPPEntity, equivalenceContext: SemanticContext): boolean {
        return sameType(other.type, this.type);
        // TODO semantic equivalence
    }
}

export function areEntitiesSemanticallyEquivalent(entity: CPPEntity | undefined, other: CPPEntity | undefined, equivalenceContext: SemanticContext) {
    return !!(entity === other // also handles case of both undefined
        || entity && other && entity.isSemanticallyEquivalent(other, equivalenceContext));
}

export abstract class NamedEntity<T extends Type = Type> extends CPPEntity<T> {

    public readonly name: string;

    /**
     * All NamedEntitys will have a name, but in some cases this might be "". e.g. an unnamed namespace.
     */
    public constructor(type: T, name: string) {
        super(type);
        this.name = name;
    }
}

export type DeclarationKind = "variable" | "function" | "class";

abstract class DeclaredEntityBase<T extends Type = Type> extends NamedEntity<T> {

    // /**
    //  * If neither entity is defined, does nothing.
    //  * If exactly one entity is defined, gives that definition to the other one as well.
    //  * If both entities are defined, throws an exception. If the entities are functions with
    //  * the same signature and different return types, throws an exception.
    //  * REQUIRES: Both entities should have the same type. (for functions, the same signature)
    //  * @param entity1 - An entity already present in a scope.
    //  * @param entity2 - A new entity matching the original one.
    //  * @throws {Note}
    //  */
    // public static merge(entity1: DeclaredEntity, entity2: DeclaredEntity) {

    //     // TODO: Add support for "forward declarations" of a class/struct

    //     // Special case: ignore magic functions
    //     if (entity1 instanceof MagicFunctionEntity || entity2 instanceof MagicFunctionEntity) {
    //         return;
    //     }

    //     // Special case: if both are definitions for the same class, it's ok ONLY if they have exactly the same tokens
    //     if (entity1.decl instanceof ClassDeclaration && entity2.decl instanceof ClassDeclaration
    //         && entity1.type.className === entity2.type.className) {
    //         if (entity1.decl.isLibraryConstruct() && entity2.decl.isLibraryConstruct() !== undefined
    //             && entity1.decl.getLibraryId() === entity2.decl.getLibraryId() ||
    //             entity1.decl.hasSourceCode() && entity2.decl.hasSourceCode() &&
    //             entity1.decl.getSourceText().replace(/\s/g,'') === entity2.decl.getSourceText().replace(/\s/g,'')) {
    //             // exactly same tokens, so it's fine

    //             // merge the types too, so that the type system recognizes them as the same
    //             Types.Class.merge(entity1.type, entity2.type);

    //             return;
    //         }
    //         else {
    //             throw CPPError.link.class_same_tokens([entity1.decl, entity2.decl], entity1, entity2);
    //         }
    //     }

    //     // If they're not the same type, that's a problem
    //     if (!sameType(entity1.type, entity2.type)) {
    //         throw CPPError.link.type_mismatch(entity1.decl, entity1, entity2);
    //     }

    //     // Special case: if both are definitions of a member inside the same class, ignore them. (The class definitions
    //     // have already been checked above and must be the same at this point, so it's pointless and will cause errors
    //     // to try to merge them.)
    //     if (entity1.decl instanceof MemberDeclaration) {
    //         return;
    //     }
    //     if (entity1.decl instanceof FunctionDefinition && entity1.decl.isInlineMemberFunction) {
    //         return; // TODO: Should we be checking this?
    //     }

    //     // Attempt to merge the two
    //     if (!entity2.isDefined() && !entity1.isDefined()) {
    //         // If both are declarations, just keep the old one
    //     }
    //     else if (entity2.isDefined() && entity1.isDefined()) {
    //         // If both are definitions, that's a problem.
    //         throw CPPError.link.multiple_def([entity1.decl, entity2.decl], entity1.name);
    //     }
    //     else { // one of them is defined and one is undefined
    //         var undefinedEntity = entity1;
    //         var definedEntity = entity2;
    //         if (entity1.isDefined()) {
    //             undefinedEntity = entity2;
    //             definedEntity = entity1;
    //         }

    //         // Check return types for functions
    //         if (entity1 instanceof FunctionEntity) {
    //             // If they have mismatched return types, that's a problem.
    //             if (!entity1.type.sameReturnType(entity2.type)){
    //                 throw CPPError.link.func.returnTypesMatch([entity1.decl, entity2.decl], entity1.name);
    //             }
    //         }

    //         // If a previous declaration, and now a new definition, merge
    //         undefinedEntity.setDefinition(definedEntity.definition);
    //     }
    // }

    public abstract readonly declarationKind: DeclarationKind;

    // TODO: not sure this should really be here as an abstract property?
    // public abstract readonly firstDeclaration: SimpleDeclaration | ParameterDeclaration | ClassDeclaration;
    // public abstract readonly declarations: readonly NonMemberSimpleDeclaration[] | readonly ParameterDefinition[] | readonly ClassDeclaration[];
    // public readonly definition?: SimpleDeclaration;

    public constructor(type: T, name: string) {
        super(type, name);
    }

    // public setDefinition(definition: SimpleDeclaration) {
    //     (<SimpleDeclaration>this.definition) = definition;
    // }

    // public isDefined() {
    //     return !!this.definition;
    // }


    // public isLibraryConstruct() {
    //     return this.decl.isLibraryConstruct();
    // }

    // public isLibraryUnsupported() {
    //     return this.decl.isLibraryUnsupported();
    // }
};

/**
 * Attempts to merge definitions. If neither entity is defined, does nothing and returns
 * the existing entity. If exactly one entity is defined, sets the definition for the
 * other one to match and returns the existing entity. If both are defined, this is an error
 * condition, so does nothing and returns false.
 * @param newEntity 
 * @param existingEntity 
 */
function mergeDefinitionInto<T extends DeclaredEntity>(newEntity: T, existingEntity: T) {

    if (newEntity.definition && existingEntity.definition) {
        if (newEntity.definition === existingEntity.definition) {
            // literally the same definition, that's fine.
            return existingEntity;
        }
        else {
            // not literally same definition, so this is an error
            return undefined;
        }
    }

    // One of them may have a definition, if so copy it over
    if (newEntity.definition) {
        // we have a definition but they don't
        asMutable(existingEntity).definition = newEntity.definition;
    }
    else if (existingEntity.definition) {
        // they have a definition but we don't
        asMutable(newEntity).definition = existingEntity.definition;
    }
    return existingEntity;
}

export class FunctionOverloadGroup {
    public readonly declarationKind = "function";

    public readonly name: string;
    private readonly _overloads: FunctionEntity[];
    public readonly overloads: readonly FunctionEntity[];

    public constructor(overloads: readonly FunctionEntity[]) {
        this.name = overloads[0].name;
        this.overloads = this._overloads = overloads.slice();
    }

    public addOverload(overload: FunctionEntity) {
        this._overloads.push(overload);
    }

    /**
     * Selects a function from the given overload group based on the signature of
     * the provided function type. (Note there's no consideration of function names here.)
     * WARNING: This function does NOT perform overload resolution. For example, it does
     * not consider the possibility of implicit conversions, which is a part of full overload
     * resolution. It simply looks for an overload with a matching signature.
     */
    public selectOverloadBySignature(type: FunctionType): FunctionEntity | undefined {
        return this.overloads.find(func => type.sameSignature(func.type));
    }
}

export type ObjectEntityType = CompleteObjectType | ReferenceType;

export interface ObjectEntity<T extends CompleteObjectType = CompleteObjectType> extends CPPEntity<T> {
    runtimeLookup(rtConstruct: RuntimeConstruct): CPPObject<T>;
    readonly variableKind: "object";
}

export interface BoundReferenceEntity<T extends ReferenceType = ReferenceType> extends CPPEntity<T> {
    name?: string;
    runtimeLookup<X extends CompleteObjectType>(this: BoundReferenceEntity<ReferenceType<X>>, rtConstruct: RuntimeConstruct): CPPObject<X> | undefined;
    readonly variableKind: "reference";
}

export interface UnboundReferenceEntity<T extends ReferenceType = ReferenceType> extends CPPEntity<T> {
    name?: string;
    bindTo<X extends CompleteObjectType>(this: UnboundReferenceEntity<ReferenceType<X>>, rtConstruct: RuntimeConstruct, obj: CPPObject<X>): void;
}

export function runtimeObjectLookup<T extends CompleteObjectType>(entity: ObjectEntity<T> | BoundReferenceEntity<ReferenceType<T>>, rtConstruct: RuntimeConstruct) {
    if (entity.variableKind === "object") {
        return entity.runtimeLookup(rtConstruct);
    }
    else if (entity.variableKind === "reference") {
        return entity.runtimeLookup(rtConstruct) || assertFalse("Attempted to look up a reference before it was bound.");
    }
    else {
        assertNever(entity);
    }
}

abstract class VariableEntityBase<T extends ObjectEntityType = ObjectEntityType> extends DeclaredEntityBase<T> {
    public readonly declarationKind = "variable";
    public abstract readonly variableKind: "reference" | "object";
    public abstract readonly variableLocation: "local" | "global" | "member";
}

export class LocalObjectEntity<T extends CompleteObjectType = CompleteObjectType> extends VariableEntityBase<T> implements ObjectEntity<T> {
    public readonly variableKind = "object";
    public readonly variableLocation = "local";
    public readonly isParameter: boolean;

    public readonly firstDeclaration: LocalVariableDefinition | ParameterDefinition;
    public readonly declarations: readonly LocalVariableDefinition[] | readonly ParameterDefinition[];
    public readonly definition: LocalVariableDefinition | ParameterDefinition;

    public constructor(type: T, def: LocalVariableDefinition | ParameterDefinition, isParameter: boolean = false) {
        super(type, def.name);
        this.firstDeclaration = def;
        this.declarations = <readonly LocalVariableDefinition[] | readonly ParameterDefinition[]>[def];
        this.definition = def;

        this.isParameter = isParameter;
    }

    public toString() {
        return this.name + " (" + this.type + ")";
    }

    public mergeInto(existingEntity: VariableEntity) {
        // Redeclaration of local is never ok
        return CPPError.declaration.prev_local(this.firstDeclaration, this.name);
    }

    public runtimeLookup(rtConstruct: RuntimeConstruct): AutoObject<T> {
        // TODO: revisit the non-null assertion below
        return rtConstruct.containingRuntimeFunction.stackFrame!.localObjectLookup(this);
    }

    public isTyped<NarrowedT extends CompleteObjectType>(predicate: (t:CompleteObjectType) => t is NarrowedT) : this is LocalObjectEntity<NarrowedT>;
    public isTyped<NarrowedT extends Type>(predicate: (t:Type) => t is NarrowedT) : this is never;
    public isTyped<NarrowedT extends CompleteObjectType>(predicate: (t:CompleteObjectType) => t is NarrowedT) : this is LocalObjectEntity<NarrowedT> {
        return predicate(this.type);
    }

    public describe() {
        return { name: this.name, message: `the ${this.isParameter ? "parameter" : "local variable"} ${this.name}` };
    }
};

export class LocalReferenceEntity<T extends ReferenceType = ReferenceType> extends VariableEntityBase<T> implements BoundReferenceEntity<T>, UnboundReferenceEntity<T> {
    public readonly variableKind = "reference";
    public readonly variableLocation = "local";
    public readonly isParameter: boolean;

    public readonly firstDeclaration: LocalVariableDefinition | ParameterDefinition;
    public readonly declarations: readonly LocalVariableDefinition[] | readonly ParameterDefinition[];
    public readonly definition: LocalVariableDefinition | ParameterDefinition;
    public readonly name: string;

    public constructor(type: T, def: LocalVariableDefinition | ParameterDefinition, isParameter: boolean = false) {
        super(type, def.name);
        this.name = def.name;
        this.firstDeclaration = def;
        this.declarations = <readonly LocalVariableDefinition[] | readonly ParameterDefinition[]>[def];
        this.definition = def;

        this.isParameter = isParameter;
    }

    public mergeInto(existingEntity: VariableEntity) {
        // Redeclaration of local is never ok
        return CPPError.declaration.prev_local(this.firstDeclaration, this.name);
    }

    public bindTo<X extends CompleteObjectType>(this: LocalReferenceEntity<ReferenceType<X>>, rtConstruct: RuntimeConstruct, obj: CPPObject<X>) {
        rtConstruct.containingRuntimeFunction.stackFrame!.bindLocalReference(this, obj);
    }

    public runtimeLookup<X extends CompleteObjectType>(this: LocalReferenceEntity<ReferenceType<X>>, rtConstruct: RuntimeConstruct): CPPObject<X> | undefined {
        // TODO: revisit the non-null assertions below
        return rtConstruct.containingRuntimeFunction.stackFrame!.localReferenceLookup<X>(this);
    }

    public isTyped<NarrowedT extends ReferenceType>(predicate: (t:ReferenceType) => t is NarrowedT) : this is LocalReferenceEntity<NarrowedT>;
    public isTyped<NarrowedT extends Type>(predicate: (t:Type) => t is NarrowedT) : this is never;
    public isTyped<NarrowedT extends ReferenceType>(predicate: (t:ReferenceType) => t is NarrowedT) : this is LocalReferenceEntity<NarrowedT> {
        return predicate(this.type);
    }

    public describe() {
        return { name: this.name, message: `the ${this.isParameter ? "reference parameter" : "reference"} ${this.name}` };
    }
};

export class GlobalObjectEntity<T extends CompleteObjectType = CompleteObjectType> extends VariableEntityBase<T> {
    public readonly variableKind = "object";
    public readonly variableLocation = "global";

    public readonly qualifiedName: QualifiedName;
    public readonly firstDeclaration: GlobalVariableDefinition;
    public readonly declarations: readonly GlobalVariableDefinition[];
    public readonly definition?: GlobalVariableDefinition;

    // storage: "static",
    constructor(type: T, decl: GlobalVariableDefinition) {
        super(type, decl.name);
        this.firstDeclaration = decl;
        this.declarations = [decl];
        // Note: this.definition is not set here because it is set later during the linking process.
        // Eventually, this constructor will take in a GlobalObjectDeclaration instead, but that would
        // require support for the extern keyword or static member variables (although that might be
        // a separate class entirely)
        this.qualifiedName = decl.qualifiedName;
    }

    public toString() {
        return this.name + " (" + this.type + ")";
    }

    public mergeInto(existingEntity: VariableEntity): VariableEntity | CompilerNote {
        if (!sameType(this.type, existingEntity.type)) {
            return CPPError.declaration.type_mismatch(this.firstDeclaration, this, existingEntity);
        }
        return mergeDefinitionInto(this, existingEntity) ??
            CPPError.declaration.variable.multiple_def(this.definition!, existingEntity.definition!);
    }

    public registerWithLinker() {
        this.firstDeclaration.context.translationUnit.program.registerGlobalObjectEntity(this);
    }

    public link(def: GlobalVariableDefinition | undefined) {
        assert(!this.definition, "link() should not be called for an entity that is already defined.");
        if (def) {
            (<Mutable<this>>this).definition = def;
        }
        else {
            this.declarations.forEach((decl) => decl.addNote(CPPError.link.def_not_found(decl, this)));
        }

    }

    public runtimeLookup(rtConstruct: RuntimeConstruct): StaticObject<T> {
        return rtConstruct.sim.memory.staticLookup(this);
    }

    public isTyped<NarrowedT extends CompleteObjectType>(predicate: (t:CompleteObjectType) => t is NarrowedT) : this is GlobalObjectEntity<NarrowedT>;
    public isTyped<NarrowedT extends Type>(predicate: (t:Type) => t is NarrowedT) : this is never;
    public isTyped<NarrowedT extends CompleteObjectType>(predicate: (t:CompleteObjectType) => t is NarrowedT) : this is GlobalObjectEntity<NarrowedT> {
        return predicate(this.type);
    }

    public describe() {
        return { name: this.name, message: "the variable " + this.name };
    }
};


export type VariableEntity<T extends PotentiallyCompleteObjectType = PotentiallyCompleteObjectType> = LocalVariableEntity<T> | GlobalVariableEntity<T> | MemberVariableEntity<T>;

export type LocalVariableEntity<T extends PotentiallyCompleteObjectType = PotentiallyCompleteObjectType> =
    LocalObjectEntity<Extract<T,CompleteObjectType>> | LocalReferenceEntity<ReferenceType<T>>;
        
export type GlobalVariableEntity<T extends PotentiallyCompleteObjectType = PotentiallyCompleteObjectType> =
    GlobalObjectEntity<Extract<T, CompleteObjectType>> | never /*GlobalReferenceEntity<ReferenceType<T>>*/;

export type MemberVariableEntity<T extends PotentiallyCompleteObjectType = PotentiallyCompleteObjectType> = 
    MemberObjectEntity<Extract<T, CompleteObjectType>> | MemberReferenceEntity<ReferenceType<T>>;


// TODO: implement global references
// export class GlobalReferenceEntity<T extends ObjectType = ObjectType> extends DeclaredEntity<T> implements BoundReferenceEntity<T>, UnboundReferenceEntity<T> {

//     public bindTo(rtConstruct : RuntimeConstruct, obj: CPPObject<T>) {
//         rtConstruct.containingRuntimeFunction.stackFrame!.bindReference(this, obj);
//     }

//     public runtimeLookup(rtConstruct: RuntimeConstruct) : CPPObject<T> {
//         // TODO: revisit the non-null assertion below
//         return rtConstruct.containingRuntimeFunction.stackFrame!.referenceLookup(this);
//     }

//     public describe() {
//         if (this.decl instanceof Declarations.Parameter){
//             return {message: "the reference parameter " + this.name};
//         }
//         else{
//             return {message: "the reference " + this.name};
//         }
//     }
// };

/**
 * Looking this entity up at runtime yields the return object of the containing runtime function.
 * Note this is generally only something you would want in the context of a return-by-value
 * function, in which case the return object is a temporary object created to eventually be initialized
 * with the returned value. In a pass-by-reference function, the return object will only exist once the
 * return has been processed and it is set to the returned object. In void function, there is no return
 * object.
 * @throws Throws an exception if the return object does not exist.
 */
export class ReturnObjectEntity<T extends CompleteObjectType = CompleteObjectType> extends CPPEntity<T> implements ObjectEntity<T> {
    public readonly variableKind = "object";

    public runtimeLookup(rtConstruct: RuntimeConstruct): CPPObject<T> {
        let returnObject = rtConstruct.containingRuntimeFunction.returnObject;
        if (!returnObject) {
            throw "Error: Runtime lookup performed for the return object of a function, but the return object does not currently exist.";
        }
        return <CPPObject<T>>returnObject;
    }

    public isTyped<NarrowedT extends CompleteObjectType>(predicate: (t:CompleteObjectType) => t is NarrowedT) : this is ReturnObjectEntity<NarrowedT>;
    public isTyped<NarrowedT extends Type>(predicate: (t:Type) => t is NarrowedT) : this is never;
    public isTyped<NarrowedT extends CompleteObjectType>(predicate: (t:CompleteObjectType) => t is NarrowedT) : this is ReturnObjectEntity<NarrowedT> {
        return predicate(this.type);
    }

    public describe() {
        // TODO: add info about which function? would need to be specified when the return value is created
        return { name: "[return]", message: "the return object" };
    }
};

export class ReturnByReferenceEntity<T extends ReferenceType = ReferenceType> extends CPPEntity<T> implements UnboundReferenceEntity<T> {

    public bindTo<X extends CompleteObjectType>(this: ReturnByReferenceEntity<ReferenceType<X>>, rtConstruct: RuntimeConstruct, obj: CPPObject<X>) {
        // Assume a ReturnByReferenceEntity will only be bound in the context of a return
        // for a return-by-reference function, thus the cast
        let func = <RuntimeFunction<FunctionType<ReferenceType<X>>>>rtConstruct.containingRuntimeFunction;
        func.setReturnObject(<any>obj);
    }

    public isTyped<NarrowedT extends ReferenceType>(predicate: (t:ReferenceType) => t is NarrowedT) : this is ReturnByReferenceEntity<NarrowedT>;
    public isTyped<NarrowedT extends Type>(predicate: (t:Type) => t is NarrowedT) : this is never;
    public isTyped<NarrowedT extends ReferenceType>(predicate: (t:ReferenceType) => t is NarrowedT) : this is ReturnByReferenceEntity<NarrowedT> {
        return predicate(this.type);
    }

    public describe() {
        // TODO: add info about which function? would need to be specified when the return value is created
        return { name: "[&return]", message: "the object returned by reference" };
    }
};

// TODO: determine what should actually be the base class here
// TODO: I think this should be an object?
// TODO: I don't think this should be an object! Move to runtimeEnvironment.ts?
// TODO: Is this needed? Can wherever uses it just keep track of the actual objects?
// export class RuntimeReference<T extends ObjectType = ObjectType> {

//     public readonly observable = new Observable(this);

//     public readonly entity: BoundReferenceEntity<T>;
//     public readonly refersTo: CPPObject<T>;

//     public constructor(entity: BoundReferenceEntity<T>, refersTo: CPPObject<T>) {
//         this.entity = entity;


//         this.refersTo = refersTo;
//         // Initially refers to a dead object at address 0
//         // TODO: this is a bad idea, so I removed it
//         // this.refersTo = new AnonymousObject(this.entity.type, memory, 0);
//     }

//     // public bindTo(refersTo: CPPObject) {
//     //     (<typeof RuntimeReference.prototype.refersTo>this.refersTo) = refersTo;
//     //     this.observable.send("bound");
//     // }

//     public describe() {
//         if (this.refersTo) {
//             return {message: "the reference " + this.entity.name + " (which is bound to " + this.refersTo.describe().message + ")"};
//         }
//         else {
//             return {message: "the reference " + this.entity.name + " (which has not yet been bound to an object)"};
//         }
//     }
// };

// TODO: will need to add a class for ReferenceParameterEntity
export class PassByValueParameterEntity<T extends CompleteObjectType = CompleteObjectType> extends CPPEntity<T> implements ObjectEntity<T> {
    public readonly variableKind = "object";

    public readonly calledFunction: FunctionEntity;
    public readonly type: T;
    public readonly num: number;

    public constructor(calledFunction: FunctionEntity, type: T, num: number) {
        super(type);
        this.calledFunction = calledFunction;
        this.type = type;
        this.num = num;
        assert(sameType(calledFunction.type.paramTypes[num], type), "Inconsistent type for parameter entity.");
    }

    public runtimeLookup(rtConstruct: RuntimeConstruct) {

        let pendingCalledFunction = rtConstruct.sim.memory.stack.topFrame()?.func;
        assert(pendingCalledFunction);
        assert(pendingCalledFunction.model === this.calledFunction.definition);

        let paramObj = pendingCalledFunction.getParameterObject(this.num);
        assert(sameType(paramObj.type, this.type));
        return <AutoObject<T>>paramObj;
    }

    public isTyped<NarrowedT extends CompleteObjectType>(predicate: (t:CompleteObjectType) => t is NarrowedT) : this is PassByValueParameterEntity<NarrowedT>;
    public isTyped<NarrowedT extends Type>(predicate: (t:Type) => t is NarrowedT) : this is never;
    public isTyped<NarrowedT extends CompleteObjectType>(predicate: (t:CompleteObjectType) => t is NarrowedT) : this is PassByValueParameterEntity<NarrowedT> {
        return predicate(this.type);
    }

    public describe() {
        let definition = this.calledFunction.definition;
        if (definition) {
            return definition.parameters[this.num].declaredEntity!.describe();
        }
        else {
            return { name: `Parameter #${this.num + 1}`, message: `Parameter #${this.num + 1} of the called function` };
        }
    }

};

export class PassByReferenceParameterEntity<T extends ReferenceType = ReferenceType> extends CPPEntity<T> implements UnboundReferenceEntity<T> {

    public readonly calledFunction: FunctionEntity;
    public readonly num: number;

    public constructor(calledFunction: FunctionEntity, type: T, num: number) {
        super(type);
        this.calledFunction = calledFunction;
        this.num = num;
        assert(sameType(calledFunction.type.paramTypes[num], type), "Inconsistent type for parameter entity.");
    }

    public bindTo<X extends CompleteObjectType>(this: PassByReferenceParameterEntity<ReferenceType<X>>, rtConstruct: RuntimeConstruct, obj: CPPObject<X>) {
        let pendingCalledFunction = rtConstruct.sim.memory.stack.topFrame()?.func;
        assert(pendingCalledFunction);
        assert(pendingCalledFunction.model === this.calledFunction.definition);

        pendingCalledFunction.bindReferenceParameter(this.num, obj);
    }

    public isTyped<NarrowedT extends ReferenceType>(predicate: (t:ReferenceType) => t is NarrowedT) : this is PassByReferenceParameterEntity<NarrowedT>;
    public isTyped<NarrowedT extends Type>(predicate: (t:Type) => t is NarrowedT) : this is never;
    public isTyped<NarrowedT extends ReferenceType>(predicate: (t:ReferenceType) => t is NarrowedT) : this is PassByReferenceParameterEntity<NarrowedT> {
        return predicate(this.type);
    }

    public describe() {
        let definition = this.calledFunction.definition;
        if (definition) {
            return definition.parameters[this.num].declaredEntity!.describe();
        }
        else {
            return { name: `Parameter #${this.num + 1}`, message: `Parameter #${this.num + 1} of the called function` };
        }
    }
};

export class ReceiverEntity extends CPPEntity<CompleteClassType> implements ObjectEntity<CompleteClassType> {
    public readonly variableKind = "object";

    constructor(type: CompleteClassType) {
        super(type);
    }

    public toString() {
        return "function receiver (" + this.type + ")";
    }

    public runtimeLookup(rtConstruct: RuntimeConstruct) {
        return rtConstruct.contextualReceiver;
    }

    public isTyped<NarrowedT extends CompleteClassType>(predicate: (t:CompleteClassType) => t is NarrowedT) : this is ReceiverEntity;
    public isTyped<NarrowedT extends Type>(predicate: (t:Type) => t is NarrowedT) : this is never;
    public isTyped<NarrowedT extends CompleteClassType>(predicate: (t:CompleteClassType) => t is NarrowedT) : this is ReceiverEntity {
        return predicate(this.type);
    }

    public describe() {
        // if (rtConstruct){
        //     return {message: "the receiver of this call to " + rtConstruct.containingRuntimeFunction().describe().message + " (i.e. *this) "};
        // }
        // else {
            return {name: "*this", message: "the receiver of this call (i.e. *this)"};
        // }
    }
};


export class NewObjectEntity<T extends NewObjectType = NewObjectType> extends CPPEntity<T> implements ObjectEntity<T> {

    public readonly variableKind = "object";

    public runtimeLookup(rtConstruct: RuntimeConstruct) {
        // no additional runtimeLookup() needed on the object since it will never be a reference
        while (rtConstruct.model.construct_type !== "new_expression" && rtConstruct.parent) {
            rtConstruct = rtConstruct.parent;
        }
        assert(rtConstruct.model.construct_type === "new_expression");
        let newRtConstruct = <RuntimeNewExpression<PointerType<T>>>rtConstruct;
        assert(newRtConstruct.allocatedObject);
        return newRtConstruct.allocatedObject;
    }

    public isTyped<NarrowedT extends NewObjectType>(predicate: (t:NewObjectType) => t is NarrowedT) : this is NewObjectEntity<NarrowedT>;
    public isTyped<NarrowedT extends Type>(predicate: (t:Type) => t is NarrowedT) : this is never;
    public isTyped<NarrowedT extends NewObjectType>(predicate: (t:NewObjectType) => t is NarrowedT) : this is NewObjectEntity<NarrowedT> {
        return predicate(this.type);
    }

    public describe() {
        return {name: "a new heap object", message: "the dynamically allocated object (of type "+this.type+") created by new"};
    }

};

export class NewArrayEntity<T extends PotentiallyCompleteArrayType = PotentiallyCompleteArrayType> extends CPPEntity<T> {

    public readonly variableKind = "object";

    public runtimeLookup(rtConstruct: RuntimeConstruct) {
        while (rtConstruct.model.construct_type !== "new_array_expression" && rtConstruct.parent) {
            rtConstruct = rtConstruct.parent;
        }
        assert(rtConstruct.model.construct_type === "new_array_expression");
        let newRtConstruct = <RuntimeNewArrayExpression<PointerType<T["elemType"]>>>rtConstruct;
        return newRtConstruct.allocatedObject;
    }

    public isTyped<NarrowedT extends PotentiallyCompleteArrayType>(predicate: (t:PotentiallyCompleteArrayType) => t is NarrowedT) : this is NewArrayEntity<NarrowedT>;
    public isTyped<NarrowedT extends Type>(predicate: (t:Type) => t is NarrowedT) : this is never;
    public isTyped<NarrowedT extends PotentiallyCompleteArrayType>(predicate: (t:PotentiallyCompleteArrayType) => t is NarrowedT) : this is NewArrayEntity<NarrowedT> {
        return predicate(this.type);
    }

    public describe() {
        return {name: "a new dynamically sized array", message: "the dynamically allocated/sized array (of element type "+this.type+") created by new"};
    }

};

export class ArraySubobjectEntity<T extends ArrayElemType = ArrayElemType> extends CPPEntity<T> implements ObjectEntity<T> {
    public readonly variableKind = "object";

    public readonly arrayEntity: ObjectEntity<BoundedArrayType<T>>;
    public readonly index: number;

    constructor(arrayEntity: ObjectEntity<BoundedArrayType<T>>, index: number) {
        super(arrayEntity.type.elemType);
        this.arrayEntity = arrayEntity;
        this.index = index;
    }

    public runtimeLookup(rtConstruct: RuntimeConstruct) {
        return this.arrayEntity.runtimeLookup(rtConstruct).getArrayElemSubobject(this.index);
    }

    public isTyped<NarrowedT extends ArrayElemType>(predicate: (t:ArrayElemType) => t is NarrowedT) : this is ArraySubobjectEntity<NarrowedT>;
    public isTyped<NarrowedT extends Type>(predicate: (t:Type) => t is NarrowedT) : this is never;
    public isTyped<NarrowedT extends ArrayElemType>(predicate: (t:ArrayElemType) => t is NarrowedT) : this is ArraySubobjectEntity<NarrowedT> {
        return predicate(this.type);
    }

    public describe() {
        let arrDesc = this.arrayEntity.describe();
        return {
            name: arrDesc.name + "[" + this.index + "]",
            message: "element " + this.index + " of " + arrDesc.message
        };
    }
}


export class DynamicLengthArrayNextElementEntity<T extends ArrayElemType = ArrayElemType> extends CPPEntity<T> implements ObjectEntity<T> {
    public readonly variableKind = "object";

    public readonly arrayEntity: NewArrayEntity<ArrayOfUnknownBoundType<T>>;

    constructor(arrayEntity: NewArrayEntity<ArrayOfUnknownBoundType<T>>) {
        super(arrayEntity.type.elemType);
        this.arrayEntity = arrayEntity;
    }

    public runtimeLookup(rtConstruct: RuntimeConstruct) {
        while (rtConstruct.model.construct_type !== "new_array_expression" && rtConstruct.parent) {
            rtConstruct = rtConstruct.parent;
        }
        assert(rtConstruct.model.construct_type === "new_array_expression");
        let newRtConstruct = <RuntimeNewArrayExpression<PointerType<T>>>rtConstruct;
        return newRtConstruct.nextElemToInit!;
    }

    public isTyped<NarrowedT extends ArrayElemType>(predicate: (t:ArrayElemType) => t is NarrowedT) : this is ArraySubobjectEntity<NarrowedT>;
    public isTyped<NarrowedT extends Type>(predicate: (t:Type) => t is NarrowedT) : this is never;
    public isTyped<NarrowedT extends ArrayElemType>(predicate: (t:ArrayElemType) => t is NarrowedT) : this is ArraySubobjectEntity<NarrowedT> {
        return predicate(this.type);
    }

    public describe() {
        let arrDesc = this.arrayEntity.describe();
        return {
            name: arrDesc.name + "[?]",
            message: "the next element of " + arrDesc.message + " to be initialized"
        };
    }
}

export class BaseSubobjectEntity extends CPPEntity<CompleteClassType> implements ObjectEntity<CompleteClassType> {
    public readonly variableKind = "object";

    public readonly containingEntity: ObjectEntity<CompleteClassType>;

    constructor(containingEntity: ObjectEntity<CompleteClassType>, type: CompleteClassType) {
        super(type);
        this.containingEntity = containingEntity;

        // This should always be true as long as we don't allow multiple inheritance
        assert(this.containingEntity.type.classDefinition.baseType?.similarType(type))
    }

    public runtimeLookup(rtConstruct: RuntimeConstruct) {
        return this.containingEntity.runtimeLookup(rtConstruct).getBaseSubobject()!;
    }

    public isTyped<NarrowedT extends CompleteClassType>(predicate: (t:CompleteClassType) => t is NarrowedT) : this is BaseSubobjectEntity;
    public isTyped<NarrowedT extends Type>(predicate: (t:Type) => t is NarrowedT) : this is never;
    public isTyped<NarrowedT extends CompleteClassType>(predicate: (t:CompleteClassType) => t is NarrowedT) : this is BaseSubobjectEntity {
        return predicate(this.type);
    }

    public describe() {
        return {
            name: "the " + this.type.className + " base class of " + this.containingEntity.describe().name,
            message: "the " + this.type.className + " base class subobject of " + this.containingEntity.describe()
        };
    }
}


// export class BaseClassEntity extends CPPEntity<ClassType> implements ObjectEntity<ClassType> {
//     protected static readonly _name = "BaseClassEntity";
//     // storage: "none",

//     public readonly access: string;
//     public readonly memberOfType: ClassType;

//     constructor(type: ClassType, memberOfType: ClassType, access: string) {
//         super(type);
//         this.memberOfType = memberOfType;
//         this.access = access;
//     }

//     public toString() {
//         return "the " + this.type.className + " base object of " + this.memberOfType.className;
//     }

//     public runtimeLookup(rtConstruct: RuntimeConstruct) {
//         var recObj = rtConstruct.contextualReceiver();

//         while(recObj && !(recObj.type instanceof this.type)){ // TODO: this isA should probably be changed to a type function
//             recObj = recObj.type.getBaseClass() && recObj.i_baseSubobjects[0];
//         }
//         Util.assert(recObj, "Internal lookup failed to find subobject in class or base classes.");

//         return recObj;
//     }

//     public objectInstance(parentObj: CPPObject<ClassType>, memory: Memory, address: number) {
//         return new BaseSubobject(parentObj, this.type, memory, address);
//     }

//     public describe() {
//         return {message: "the " + this.type.className + " base object of " + this.memberOfType.className};
//     }
// };

abstract class MemberVariableEntityBase<T extends ObjectEntityType = ObjectEntityType> extends VariableEntityBase<T> {

    public readonly variableLocation = "member";

    public readonly firstDeclaration: MemberVariableDeclaration;
    public readonly declarations: readonly MemberVariableDeclaration[];
    public readonly definition: undefined; // non-static member variables never have definitions

    public constructor(type: T, decl: MemberVariableDeclaration) {
        super(type, decl.name);
        this.firstDeclaration = decl;
        this.declarations = [decl];
    }

    public toString() {
        return this.name + " (" + this.type + ")";
    }

    public mergeInto(existingEntity: VariableEntity) {
        // Redeclaration of member variable is never ok
        return CPPError.declaration.prev_member(this.firstDeclaration, this.name);
    }

    public describe() {
        return { name: this.name, message: `the member ${this.name}` };
        // if (rtConstruct){
        //     var recObj = rtConstruct.contextualReceiver();
        //     if (recObj.name){
        //         return {message: recObj.name + "." + this.name};
        //     }
        //     else{
        //         return {message: "the member " + this.name + " of " + recObj.describe().message};
        //     }
        // }
        // else{
        //     return {
        //         name: this.memberOfType.className + "." + this.name,
        //         message: "the " + this.name + " member of the " + this.memberOfType.className + " class"
        //     };
        // }
    }
};

export class MemberObjectEntity<T extends CompleteObjectType = CompleteObjectType> extends MemberVariableEntityBase<T> {
    public readonly variableKind = "object";
    
    public runtimeLookup(rtConstruct: RuntimeConstruct) {
        // Cast below should be <CPPObject<T>>, NOT MemberSubobject<T>.
        // See return type and documentation for getMemberObject()
        return <CPPObject<T>>rtConstruct.contextualReceiver.getMemberObject(this.name);
    }

    public isTyped<NarrowedT extends CompleteObjectType>(predicate: (t:CompleteObjectType) => t is NarrowedT) : this is MemberObjectEntity<NarrowedT>;
    public isTyped<NarrowedT extends Type>(predicate: (t:Type) => t is NarrowedT) : this is never;
    public isTyped<NarrowedT extends CompleteObjectType>(predicate: (t:CompleteObjectType) => t is NarrowedT) : this is MemberObjectEntity<NarrowedT> {
        return predicate(this.type);
    }

}

export class MemberReferenceEntity<T extends ReferenceType = ReferenceType> extends MemberVariableEntityBase<T> implements BoundReferenceEntity<T>, UnboundReferenceEntity<T> {

    public readonly variableKind = "reference";
    

    public runtimeLookup<X extends CompleteObjectType>(this: MemberReferenceEntity<ReferenceType<X>>, rtConstruct: RuntimeConstruct) {
        // Cast below should be <CPPObject<T>>, NOT MemberSubobject<T>.
        // See return type and documentation for getMemberObject()
        return <CPPObject<X>>rtConstruct.contextualReceiver.getMemberObject(this.name);
    }

    public bindTo<X extends CompleteObjectType>(this: MemberReferenceEntity<ReferenceType<X>>, rtConstruct: RuntimeConstruct, obj: CPPObject<X>) {
        rtConstruct.contextualReceiver.bindMemberReference(this.name, obj)
    }

    public isTyped<NarrowedT extends ReferenceType>(predicate: (t:ReferenceType) => t is NarrowedT) : this is MemberReferenceEntity<NarrowedT>;
    public isTyped<NarrowedT extends Type>(predicate: (t:Type) => t is NarrowedT) : this is never;
    public isTyped<NarrowedT extends ReferenceType>(predicate: (t:ReferenceType) => t is NarrowedT) : this is MemberReferenceEntity<NarrowedT> {
        return predicate(this.type);
    }

};

export class TemporaryObjectEntity<T extends CompleteObjectType = CompleteObjectType> extends CPPEntity<T> implements ObjectEntity<T> {
    public readonly variableKind = "object";
    protected static readonly _name = "TemporaryObjectEntity";
    // storage: "temp",

    public readonly creator: PotentialFullExpression;
    public readonly owner: PotentialFullExpression;
    public readonly name: string;

    constructor(type: T, creator: PotentialFullExpression, owner: PotentialFullExpression, name: string) {
        super(type);
        this.creator = creator;
        this.owner = owner;
        this.name = name;
    }

    public setOwner(newOwner: PotentialFullExpression) {
        (<Mutable<this>>this).owner = newOwner;
    }

    public objectInstance(creatorRt: RuntimePotentialFullExpression) {

        let objInst: TemporaryObject<T> = creatorRt.sim.memory.allocateTemporaryObject(this);

        let owner = creatorRt.containingFullExpression;
        owner.temporaryObjects[this.entityId] = objInst;
        return objInst;
    }

    public runtimeLookup(rtConstruct: RuntimeConstruct) {
        // Some hacky casts and assertions in this implementation
        // if (!(rtConstruct instanceof RuntimePotentialFullExpression)) { // removed since it causes an issue with a circular import dependency
        //     return assertFalse();
        // }
        return <TemporaryObject<T>>(<RuntimePotentialFullExpression>rtConstruct).containingFullExpression.temporaryObjects[this.entityId];
    }

    public isTyped<NarrowedT extends CompleteObjectType>(predicate: (t:CompleteObjectType) => t is NarrowedT) : this is TemporaryObjectEntity<NarrowedT>;
    public isTyped<NarrowedT extends Type>(predicate: (t:Type) => t is NarrowedT) : this is never;
    public isTyped<NarrowedT extends CompleteObjectType>(predicate: (t:CompleteObjectType) => t is NarrowedT) : this is TemporaryObjectEntity<NarrowedT> {
        return predicate(this.type);
    }

    public describe() {
        return { name: this.name, message: this.name }; // TOOD: eventually change implementation when I remove name
    }

}


let FE_overrideID = 0;
export class FunctionEntity<T extends FunctionType = FunctionType> extends DeclaredEntityBase<T> {
    public readonly declarationKind = "function";

    public readonly qualifiedName: QualifiedName;
    public readonly firstDeclaration: FunctionDeclaration;
    public readonly declarations: readonly FunctionDeclaration[];
    public readonly definition?: FunctionDefinition;

    public readonly isMemberFunction: boolean;
    public readonly isVirtual: boolean;
    public readonly isPureVirtual: boolean;
    public readonly isConstructor: boolean;
    public readonly isDestructor: boolean;

    public readonly isOdrUsed: boolean = false;

    public readonly isImplicit: boolean;
    public readonly isUserDefined: boolean;

    public readonly overrideID: number;

    public readonly overriders: {
        [index: string]: FunctionEntity;
    } = {};
    public readonly overrideTarget?: FunctionEntity;

    // storage: "static",
    constructor(type: T, decl: FunctionDeclaration) {
        super(type, decl.name);
        this.firstDeclaration = decl;
        this.declarations = [decl];
        this.isMemberFunction = decl.isMemberFunction;
        this.isVirtual = decl.isVirtual;
        this.isPureVirtual = false;
        this.isConstructor = decl.isConstructor;
        this.isDestructor = decl.isDestructor;
        this.qualifiedName = decl.qualifiedName;

        this.isImplicit = !!decl.context.implicit;
        this.isUserDefined = !decl.context.implicit;

        this.overrideID = FE_overrideID++;
        if (this.isMemberFunction) {
            assert(isClassContext(decl.context));
            this.overriders[decl.context.containingClass.qualifiedName.str] = this;
        }
    }

    public addDeclaration(decl: FunctionDeclaration) {
        asMutable(this.declarations).push(decl);
    }

    public addDeclarations(decls: readonly FunctionDeclaration[]) {
        decls.forEach((decl) => asMutable(this.declarations).push(decl));
    }

    public toString() {
        return this.name;
    }

    public registerOverrider(containingClass: ClassEntity, overrider: FunctionEntity) {
        this.overriders[containingClass.qualifiedName.str] = overrider;
        this.overrideTarget?.registerOverrider(containingClass, overrider);
    }

    public setOverrideTarget(target: FunctionEntity) {
        assert(!this.overrideTarget, "A single FunctionEntity may not have multiple override targets.")
        asMutable(this).overrideTarget = target;

    }

    // private checkForOverride(baseClass: ClassDefinition) {
    //     baseClass.memberFunctionEntities.forEach(func => {
    //         if (func.type.sameSignature(this.type)) {
    //             func.registerOverrider(this);
    //         }
    //     })

    //     // Find the nearest overrider of a hypothetical virtual function.
    //     // If any are virtual, this one would have already been set to be
    //     // also virtual by this same procedure, so checking this one is sufficient.
    //     // If we override any virtual function, this one is too.
    //     var overridden = this.containingClass.getBaseClass().classScope.singleLookup(this.name, {
    //         paramTypes: this.type.paramTypes, isThisConst: this.type.isThisConst,
    //         exactMatch:true, own:true, noNameHiding:true});

    //     if (overridden && overridden instanceof FunctionEntity && overridden.isVirtual){
    //         (<boolean>this.isVirtual) = true;
    //         // Check to make sure that the return types are covariant
    //         if (!covariantType(this.type.returnType, overridden.type.returnType)){
    //             throw SemanticExceptions.NonCovariantReturnTypes.instance(this, overridden);
    //         }
    //     }
    // }

    public mergeInto(overloadGroup: FunctionOverloadGroup): FunctionEntity | CompilerNote {
        //check each other function found
        let matchingFunction = overloadGroup.selectOverloadBySignature(this.type);

        if (!matchingFunction) {
            // If none were found with the same signature, this is a new overload, so go ahead and add it
            overloadGroup.addOverload(this);
            return this;
        }

        // If they have mismatched return types, that's a problem.
        if (!this.type.sameReturnType(matchingFunction.type)) {
            return CPPError.declaration.func.returnTypesMatch([this.firstDeclaration, matchingFunction.firstDeclaration], this.name);
        }

        // As a sanity check, make sure they're the same type.
        // But this should already be true, given that they have the same signature and return type.
        if (!sameType(this.type, matchingFunction.type)) {
            return CPPError.declaration.type_mismatch(this.firstDeclaration, this, matchingFunction);
        }

        matchingFunction.addDeclarations(this.declarations);

        return mergeDefinitionInto(this, matchingFunction) ??
            CPPError.declaration.func.multiple_def(this.definition!, matchingFunction.definition!);
    }

    public setDefinition(def: FunctionDefinition) {
        if (!this.definition) {
            (<Mutable<this>>this).definition = def;
        }
        else {
            def.addNote(CPPError.declaration.func.multiple_def(def, this.definition));
        }
    }

    public registerWithLinker() {
        this.firstDeclaration.context.program.registerFunctionEntity(this);
    }

    public link(def: FunctionDefinitionGroup | undefined) {
        assert(!this.definition, "link() should not be called for an entity that is already defined.");

        if (def) {
            // found an overload group of function definitions, check for one
            // with matching signature to the given linked entity
            let overload = selectOverloadedDefinition(def.definitions, this.type);
            if (!overload) {
                if (this.isOdrUsed) {
                    this.declarations.forEach((decl) => decl.addNote(CPPError.link.func.no_matching_overload(decl, this)));
                }
                return;
            }

            // check return type
            if (!this.type.sameReturnType(overload.declaration.type)) {
                this.declarations.forEach((decl) => decl.addNote(CPPError.link.func.returnTypesMatch(decl, this)));
                return;
            }

            (<Mutable<this>>this).definition = overload;
        }
        else {
            if (this.isMemberFunction && this.isVirtual && !this.isPureVirtual) {
                // All (non-pure) virtual functions must have a definition
                this.declarations.forEach((decl) => decl.addNote(CPPError.link.func.virtual_def_required(decl, this)));
            }
            else if (this.isOdrUsed) {
                // Functions that are ODR-used must have a definition
                this.declarations.forEach((decl) => decl.addNote(CPPError.link.func.def_not_found(decl, this)));
            }
            // Otherwise, it's ok for the function to not have a definition because it is never used
        }

    }

    public isMain() {
        return this.qualifiedName.str === "main";
    }

    public getDynamicallyBoundFunction(receiver: CPPObject<CompleteClassType> | undefined) {
        if (!this.isVirtual) {
            assert(this.definition, "non virtual function must have a definition!");
            return this.definition;
        }
        else {
            assert(receiver, "virtual function dynamic binding requires a receiver");
            while (receiver instanceof BaseSubobject) {
                receiver = receiver.containingObject;
            }
            let dynamicType: CompleteClassType | undefined = receiver.type;
            let finalOverrider: FunctionEntity | undefined;
            while (!finalOverrider && dynamicType) {
                finalOverrider = this.overriders[dynamicType.qualifiedName.str];
                dynamicType = dynamicType.classDefinition.baseType;
            }
            return finalOverrider?.definition || this.definition;
        }
    }

    public registerCall(call: FunctionCall) {
        (<Mutable<this>>this).isOdrUsed = true;
    }

    public returnsVoid() : this is FunctionEntity<FunctionType<VoidType>> {
        return this.type.returnType.isVoidType();
    }

    public returnsCompleteType() : this is FunctionEntity<FunctionType<CompleteReturnType>> {
        return this.type.returnType.isCompleteReturnType();
    }

    public isTyped<NarrowedT extends FunctionType>(predicate: (t:FunctionType) => t is NarrowedT) : this is FunctionEntity<NarrowedT>;
    public isTyped<NarrowedT extends Type>(predicate: (t:Type) => t is NarrowedT) : this is never;
    public isTyped<NarrowedT extends FunctionType>(predicate: (t:FunctionType) => t is NarrowedT) : this is FunctionEntity<NarrowedT> {
        return predicate(this.type);
    }

    public describe(): EntityDescription {
        return {
            name: this.name,
            message: `the ${this.name} function`
        };
    }
}

export class ClassEntity extends DeclaredEntityBase<PotentiallyCompleteClassType> {
    public readonly declarationKind = "class";

    public readonly qualifiedName: QualifiedName;
    public readonly firstDeclaration: ClassDeclaration;
    public readonly declarations: readonly ClassDeclaration[];
    public readonly definition?: ClassDefinition;

    public constructor(decl: ClassDeclaration) {

        // Ask the type system for the appropriate type.
        // Because Lobster only supports mechanisms for class declaration that yield
        // classes with external linkage, it is sufficient to use the fully qualified
        // class name to distinguish types from each other.

        super(createClassType(decl.name, decl.qualifiedName), decl.name);
        this.firstDeclaration = decl;
        this.declarations = [decl];
        this.qualifiedName = decl.qualifiedName;
    }

    public isComplete() : this is CompleteClassEntity {
        return !!this.definition && this.type.isCompleteClassType();
    }

    public toString() {
        return this.name;
    }

    public addDeclaration(decl: ClassDeclaration) {
        asMutable(this.declarations).push(decl);
    }

    public addDeclarations(decls: readonly ClassDeclaration[]) {
        decls.forEach((decl) => asMutable(this.declarations).push(decl));
    }

    /**
     * Merge this class entity into a previous existing class entity.
     * If exactly one of the entities has a definition, the other one assumes
     * that definition as well. If both have a definition, an error is returned
     * unless the two are literally the same definition. (Note that an error
     * is thrown in the case of separate definitions with the same exact source
     * tokens, because the use of `mergeInto` means these definitions occur in the
     * same translation unit, which is prohibited.)
     * @param existingEntity
     */
    public mergeInto(existingEntity: ClassEntity) {

        existingEntity.addDeclarations(this.declarations);

        return mergeDefinitionInto(this, existingEntity) ??
            CPPError.declaration.classes.multiple_def(this.definition!, existingEntity.definition!);
    }

    public setDefinition(def: ClassDefinition) {
        if (!this.definition) {
            (<Mutable<this>>this).definition = def;
            this.type.setDefinition(def);
        }
        else {
            def.addNote(CPPError.declaration.classes.multiple_def(def, this.definition));
        }
    }

    public registerWithLinker() {
        this.firstDeclaration.context.translationUnit.program.registerClassEntity(this);
    }

    public link(def: ClassDefinition | undefined) {
        assert(!this.definition, "link() should not be called for an entity that is already defined.");
        if (def) {
            this.setDefinition(def);
        }
        else {
            this.declarations.forEach((decl) => decl.addNote(CPPError.link.classes.def_not_found(decl, this)));
        }
    }

    public isTyped<NarrowedT extends PotentiallyCompleteClassType>(predicate: (t:PotentiallyCompleteClassType) => t is NarrowedT) : this is ClassEntity;
    public isTyped<NarrowedT extends Type>(predicate: (t:Type) => t is NarrowedT) : this is never;
    public isTyped<NarrowedT extends PotentiallyCompleteClassType>(predicate: (t:PotentiallyCompleteClassType) => t is NarrowedT) : this is ClassEntity {
        return predicate(this.type);
    }

    public describe(): EntityDescription {
        return {
            name: this.name,
            message: `the ${this.name} function`
        };
    }
}

export interface CompleteClassEntity extends ClassEntity {
    readonly type: CompleteClassType;
    readonly definition: ClassDefinition;
}


// export class MagicFunctionEntity extends FunctionEntity {
//     public constructor(decl: SimpleDeclaration) {
//         super(decl);
//         this.setDefinition(decl);
//     }

//     public describe() {
//         return {message: "no description available"};
//     }
// }


// export class MemberFunctionEntity extends FunctionEntity {

//     public readonly containingClass: Types.Class;
//     public readonly isVirtual: boolean;
//     public readonly pureVirtual: boolean;

//     constructor(decl: SimpleDeclaration, containingClass: Types.Class, isVirtual: boolean) {
//         super(decl);
//         this.containingClass = containingClass;
//         this.isVirtual = isVirtual;
//         this.pureVirtual = decl.pureVirtual;
//         // May also be set to virtual later if it's discovered to be an overrider
//         // for a virtual function in a base class

//         this.checkForOverride();
//     }



//     public isStaticallyBound() {
//         return !this.isVirtual;
//     }

//     public isLinked() {
//         return this.virtual && this.pureVirtual || this.isDefined();
//     }

//     public runtimeLookup(sim: Simulation, rtConstruct: RuntimeConstruct) {
//         if (this.isVirtual){
//             // If it's a virtual function start from the class scope of the dynamic type
//             var receiver = rtConstruct.contextualReceiver();
//             Util.assert(receiver, "dynamic function lookup requires receiver");
//             var dynamicType = receiver.type;

//             // Sorry this is hacky :(
//             // If it's a destructor, we look instead for the destructor of the dynamic type
//             var func;
//             if (this.definition instanceof DestructorDefinition) {
//                 func = dynamicType.destructor;
//             }
//             else{
//                 func = dynamicType.classScope.singleLookup(this.name, {
//                     paramTypes: this.type.paramTypes, isThisConst: this.type.isThisConst,
//                     exactMatch:true, own:true, noNameHiding:true});
//             }
//             Util.assert(func, "Failed to find virtual function implementation during lookup.");
//             return func;
//         }
//         else{
//             return this;
//         }
//     }

//     public suppressedVirtualProxy() : MemberFunctionEntity {
//         var proxy = Object.create(this);
//         proxy.isVirtual = false;
//         return proxy;
//     }

// };

// export class ConstructorEntity extends MemberFunctionEntity {

// }


// export class PointedFunctionEntity extends CPPEntity {
//     protected static readonly _name = "FunctionEntity";

//     private readonly desc: string;

//     constructor(type: Type) {
//         super(type);
//         this.desc = "Unknown function of type " + type;
//     }

//     public isStaticallyBound() {
//         return true;
//     }

//     public toString() {
//         return this.desc;
//     }

//     public runtimeLookup(sim: Simulation, rtConstruct: RuntimeConstruct) {
//         return rtConstruct.pointedFunction.runtimeLookup(sim, rtConstruct);
//     }

//     public isLinked() {
//         return true;
//     }

//     public describe() {
//         return {message: "no description available"};
//     }
// }



// export class TypeEntity extends DeclaredEntity {
//     protected static readonly _name = "TypeEntity";

//     public toString() {
//         return "TypeEntity: " + this.type.instanceString();
//     }

//     public describe() {
//         return this.type.describe();
//     }
// };


function convLen(args: readonly Expression[]) {
    return args.reduce((res, exp) => res + exp.conversionLength, 0);
};

// Selects from candidates the function that is the best match
// for the arguments in the args array. Also modifies args so
// that each argument is amended with any implicit conversions
// necessary for the match.
// Options:
//   problems - an array that will be filled with an entry for each candidate
//              consisting of an array of any semantic problems that prevent it
//              from being chosen.






/**
 * Selects a function from the given overload group based on the signature of
 * the provided function type. (Note there's no consideration of function names here.)
 */
export function selectOverloadedDefinition(overloadGroup: readonly FunctionDefinition[], type: FunctionType) {
    return overloadGroup.find(func => type.sameSignature(func.declaration.type));
}