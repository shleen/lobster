import { CPPConstruct, RuntimeConstruct, CompiledConstruct, RuntimeFunction } from "../core/constructs";
import { RuntimePotentialFullExpression } from "../core/PotentialFullExpression";
import { SimulationOutlet } from "./simOutlets";
import { Mutable, asMutable, assertFalse, htmlDecoratedType, htmlDecoratedName, htmlDecoratedKeyword, htmlDecoratedOperator, assert } from "../util/util";
import { listenTo, stopListeningTo, messageResponse, Message, MessageResponses, Observable } from "../util/observe";
import { CompiledFunctionDefinition, CompiledSimpleDeclaration, ParameterDefinition, CompiledParameterDefinition } from "../core/declarations";
import { RuntimeBlock, CompiledBlock, RuntimeStatement, CompiledStatement, RuntimeDeclarationStatement, CompiledDeclarationStatement, RuntimeExpressionStatement, CompiledExpressionStatement, RuntimeIfStatement, CompiledIfStatement, RuntimeWhileStatement, CompiledWhileStatement, CompiledForStatement, RuntimeForStatement, RuntimeReturnStatement, CompiledReturnStatement, RuntimeNullStatement, CompiledNullStatement } from "../core/statements";
import { RuntimeInitializer, CompiledInitializer, RuntimeDefaultInitializer, CompiledDefaultInitializer, DefaultInitializer, DirectInitializer, CopyInitializer, CompiledCopyInitializer, RuntimeCopyInitializer, RuntimeAtomicDefaultInitializer, CompiledAtomicDefaultInitializer, RuntimeArrayDefaultInitializer, CompiledArrayDefaultInitializer, RuntimeDirectInitializer, CompiledDirectInitializer, RuntimeAtomicDirectInitializer, CompiledAtomicDirectInitializer, RuntimeAtomicCopyInitializer, CompiledAtomicCopyInitializer, RuntimeReferenceDirectInitializer, CompiledReferenceDirectInitializer, RuntimeReferenceCopyInitializer, CompiledReferenceCopyInitializer } from "../core/initializers";
import { RuntimeExpression, Expression, CompiledExpression } from "../core/expressionBase";
import { CPPObject } from "../core/objects";
import { FunctionEntity } from "../core/entities";
import { Value } from "../core/runtimeEnvironment";
import { RuntimeAssignment, RuntimeTernary, CompiledAssignment, CompiledTernary, RuntimeComma, CompiledComma, RuntimeLogicalBinaryOperator, RuntimeRelationalBinaryOperator, CompiledBinaryOperator, RuntimeArithmeticBinaryOperator, CompiledArithmeticBinaryOperator, CompiledRelationalBinaryOperator, CompiledLogicalBinaryOperator, RuntimeUnaryOperator, CompiledUnaryOperator, RuntimeSubscriptExpression, CompiledSubscriptExpression, RuntimeParentheses, CompiledParentheses, RuntimeObjectIdentifier, CompiledObjectIdentifier, RuntimeNumericLiteral, CompiledNumericLiteral, RuntimeBinaryOperator, RuntimeFunctionIdentifier, CompiledFunctionIdentifier, RuntimeMagicFunctionCallExpression, CompiledMagicFunctionCallExpression } from "../core/expressions";
import { Bool } from "../core/types";
import { RuntimeImplicitConversion, CompiledImplicitConversion } from "../core/standardConversions";
import { mixin } from "lodash";
import { CompiledFunctionCall, RuntimeFunctionCall, RuntimeFunctionCallExpression, CompiledFunctionCallExpression } from "../core/functionCall";

const EVAL_FADE_DURATION = 500;
const RESET_FADE_DURATION = 500;

export const CODE_ANIMATIONS = true;

export abstract class ConstructOutlet<RTConstruct_type extends RuntimeConstruct = RuntimeConstruct> {

    protected readonly element: JQuery;
    protected readonly construct: RTConstruct_type["model"];

    public readonly parent?: ConstructOutlet;
    public readonly inst?: RTConstruct_type;

    public _act!: MessageResponses;
    public readonly observable = new Observable(this);

    /**
     * Children are stored by the ID of the CPPConstruct they display.
     */
    private readonly children: {[index: number]: ConstructOutlet} = {}; 
    
    public constructor(element: JQuery, construct: RTConstruct_type["model"], parent?: ConstructOutlet) {
        this.element = element;
        this.construct = construct;

        if (parent) {
            parent.addChildOutlet(this);
        }

        this.element.addClass("codeInstance");
        this.element.append("<span class=\"highlight\"></span>");
    }

    public setRuntimeInstance(inst: RTConstruct_type) {
        if (this.inst) {
            this.removeInstance();
        }

        (<Mutable<this>>this).inst = inst;
        if (this.inst) {
            listenTo(this, inst);
        }

        this.element.removeClass("upNext");
        this.element.removeClass("wait");
        this.instanceSet(inst);

        for(let id in inst.pushedChildren) {
            this.setChildInstance(inst.pushedChildren[id]);
        }
    }

    protected instanceSet(inst: RTConstruct_type) {

    }

    public removeInstance() {

        // Note: should be a fact that if I have no instance, neither do my children
        if (this.inst) {

            // First remove children instances (deepest children first, due to recursion)
            for (let c in this.children){
                this.children[c].removeInstance();
            }

            stopListeningTo(this, this.inst);

            delete (<Mutable<this>>this).inst;
            
            this.element.removeClass("upNext");
            this.element.removeClass("wait");
            this.instanceRemoved();
        }
    }

    protected instanceRemoved() {

    }

    private addChildOutlet(child: ConstructOutlet) {
        this.children[child.construct.constructId] = child;
        (<Mutable<ConstructOutlet>>child).parent = this;
    }
    
    private setChildInstance(childInst: RuntimeConstruct) {
        let childOutlet = this.children[childInst.model.constructId];

        // If we have a child outlet waiting, go for it
        if (childOutlet) {
            childOutlet.setRuntimeInstance(childInst);
            return;
        }

        // Otherwise, pass to parent that may have a suitable outlet
        if (this.parent) {
            this.parent.setChildInstance(childInst);
        }
        else{
            // Just ignore it?
            console.log("WARNING! Child instance pushed for which no corresponding child outlet was found! (" + childInst.model.toString() + ")");
        }
    }


    @messageResponse("upNext")
    private upNext() {
        this.element.removeClass("wait");
        this.element.addClass("upNext");
    }

    @messageResponse("wait")
    private wait() {
        this.element.removeClass("upNext");
        this.element.addClass("wait");
    }

    // TODO: move this to a function subclass?
    @messageResponse("popped")
    private popped() {
        // this.inst! must be defined if this function is called, since it would have had to send the message
        this.element.removeClass("upNext");
        this.element.removeClass("wait");
    }

    // Called when child instance is created under any instance this
    // outlet is listening to. Looks for a child outlet of this outlet
    // that is waiting for the code model associated with the instance.
    // Propagates the child instance upward through ancestors until one
    // is found that was waiting for it.
    @messageResponse("childPushed")
    private childPushed(msg: Message<RuntimeConstruct>) {
        this.setChildInstance(msg.data);
    }

    @messageResponse("current")
    private current() {
        this.element.addClass("current");
    }

    @messageResponse("uncurrent")
    private uncurrent() {
        this.element.removeClass("current");
    }

    @messageResponse("identifyCodeOutlet")
    private identifyCodeOutlet(msg: Message<(me: this) => void>) {
        msg.data(this);
    }
}


export class PotentialFullExpressionOutlet<RT extends RuntimePotentialFullExpression = RuntimePotentialFullExpression> extends ConstructOutlet<RT> {
    public constructor(element: JQuery, construct: RT["model"], parent?: ConstructOutlet) {
        super(element, construct, parent);
        
        // if (this.construct.temporaryDeallocator) {
        //     this.construct.temporaryDeallocator.dtors.forEach((tempDest) => {
        //         this.addChildOutlet(Outlets.CPP.FunctionCall.instance(tempDest, this, []));
        //     });
        // }

        //if (this.construct.isFullExpression()){
        //    var this = this;
        //    this.exprElem.hover(() => {
        //        //alert("hi");
        //        this.element.addClass("current");
        //    },() => {
        //        //alert("hi");
        //        this.element.removeClass("current");
        //        //this.simOutlet.sim.closeMessage();
        //    }).click(() => {
        //        this.simOutlet.sim.explain(this.inst ? this.inst.explain() : this.code.explain(this.simOutlet.sim));
        //    });
        //}
    }
}

export class FunctionOutlet extends ConstructOutlet<RuntimeFunction> {

    public readonly body: BlockOutlet;

    private readonly paramsElem: JQuery;

    public constructor(element: JQuery, rtFunc: RuntimeFunction) {
        super(element, rtFunc.model);

        this.element.addClass("function");

        // Set up DOM and child outlets
        // if (!isA(this.code, ConstructorDefinition) && !isA(this.code, DestructorDefinition)){ // Constructors/destructors use this outlet too for now and they don't have return type
        //     var returnTypeElem = $('<span class="code-returnType">' + this.construct.type.returnType.toString() + "</span>");
        //     this.element.append(returnTypeElem);
        //     this.element.append(" ");
        // }
        var nameElem = $('<span class="code-functionName">' + this.construct.name + "</span>");
        this.element.append(nameElem);

        this.paramsElem = $("<span>()</span>");
        this.element.append(this.paramsElem);


        // ctor-initializer
        // let memInits = this.construct.memberInitializers;
        // if (memInits && memInits.length > 0){
        //     this.element.append("\n : ");
        //     for(let i = 0; i < memInits.length; ++i){
        //         let mem = memInits[i];
        //         this.element.append(htmlDecoratedName(mem.entity.name, mem.entity.type));
        //         let memElem = $("<span></span>");
        //         createCodeOutlet(memElem, mem, this);
        //         this.element.append(memElem);
        //         if (i != memInits.length - 1){
        //             this.element.append(", ");
        //         }
        //     }
        // }

        let bodyElem = $("<span></span>").appendTo(this.element);
        this.body = new BlockOutlet(bodyElem, this.construct.body, this);

        // if (this.construct.autosToDestruct){
        //     this.construct.autosToDestruct.forEach((dest) => {
        //         this.addChildOutlet(Outlets.CPP.FunctionCall.instance(dest, this, []));
        //     });
        // }
        // if (this.construct.membersToDestruct){
        //     this.construct.membersToDestruct.forEach((dest) => {
        //         this.addChildOutlet(Outlets.CPP.FunctionCall.instance(dest, this, []));
        //     });
        // }
        // if (this.construct.basesToDestruct){
        //     this.construct.basesToDestruct.forEach((dest) => {
        //         this.addChildOutlet(Outlets.CPP.FunctionCall.instance(dest, this, []));
        //     });
        // }

        this.setRuntimeInstance(rtFunc);
        
    }

    protected instanceSet(inst: RuntimeFunction) {

        if (inst.hasControl) {
            this.element.addClass("hasControl");
        }

        if (!inst.caller) {
            // special case - if no caller, it must be the main function
            this.paramsElem.html("()");
            return;
        }

        // Set up parameter outlets
        this.paramsElem.empty();
        this.paramsElem.append("(");
        //let paramElems = [];
        let paramDefs = inst.model.parameters;
        paramDefs.forEach((paramDef, i) => {
            let elem = $("<span></span>");
            let paramOutlet = new ParameterOutlet(elem, paramDef);
            //this.addChildOutlet(paramOutlet);
            //paramElems.push(elem);
            this.paramsElem.append(elem);
            if (i < paramDefs.length - 1) {
                this.paramsElem.append(", ");
            }
        });
        this.paramsElem.append(")");
    }

    @messageResponse("gainControl")
    private gainControl() {
        this.element.addClass("hasControl");
    }

    @messageResponse("loseControl")
    private loseControl() {
        this.element.removeClass("hasControl");
    }



    // _act: mixin({}, Outlets.CPP.Code._act, {

    //     tailCalled : function(msg){
    //         this.setUpParams();
    //     },
    //     reset : function(msg){
    //         this.body.removeInstance();
    //     }

    // }, true)
}

var curlyOpen = "<span class=\"curly-open\">{</span>";
var curlyClose = "<span class=\"curly-close\">}</span>";

export class BlockOutlet extends ConstructOutlet<RuntimeBlock> {

    public constructor(element: JQuery, construct: CompiledBlock, parent?: ConstructOutlet) {
        super(element, construct, parent);
        
        this.element.removeClass("codeInstance");
        this.element.addClass("braces");
        this.element.append(curlyOpen);
        this.element.append("<br />");
        let innerElem = $("<span class=\"inner\"><span class=\"highlight\"></span></span>");
        innerElem.addClass("block");
        this.element.append(innerElem);

        // this.gotoLinks = [];
        //let statementElems = [];
        this.construct.statements.forEach(stmt => {
            let lineElem = $('<span class="blockLine"></span>');
            let elem = $("<span></span>");
            let child = createStatementOutlet(elem, stmt, this);

            // let gotoLink = $('<span class="gotoLink link">>></span>');
            // lineElem.append(gotoLink);
            // this.gotoLinks.push(gotoLink);
            // //gotoLink.css("visibility", "hidden");
            // let self = this;

            // // wow this is really ugly lol. stupid closures
            // gotoLink.click(
            //     function (x) {
            //         return function () {
            //             if (!self.inst){
            //                 return;
            //             }

            //             var me = $(this);
            //             //if (self.gotoInProgress){
            //             //    return;
            //             //}
            //             //self.gotoInProgress = true;
            //             var temp = me.html();
            //             if (me.html() == "&lt;&lt;"){
            //                 self.simOutlet.simOutlet.stepBackward(self.simOutlet.sim.stepsTaken() - self.inst.childInstances.statements[x].stepsTaken);
            //                 return;
            //             }


            //             me.addClass("inProgress");

            //             self.inst.pauses[x] = {pauseAtIndex: x, callback: function(){
            //                 //self.gotoInProgress = false;
            //                 me.removeClass("inProgress");
            //             }};
            //             //if (self.inst.pauses[x]){
            //                 self.simOutlet.send("skipToEnd");
            //             //}
            //         };
            //     }(i));

            lineElem.append(elem);
            innerElem.append(lineElem);
            innerElem.append("<br />");
        });

        this.element.append("<br />");
        this.element.append(curlyClose);

//        this.element.append("}");


    }

    // instanceSet : function(){
    //     Outlets.CPP.Block._parent.instanceSet.apply(this, arguments);
    //     for(var i = 0; i < this.inst.index; ++i){
    //         this.gotoLinks[i].html("<<").css("visibility", "visible");
    //     }
    //     for(var i = this.inst.index; i < this.gotoLinks.length; ++i){
    //         this.gotoLinks[i].html(">>").css("visibility", "visible");
    //     }
    // }

    // instanceRemoved : function(){
    //     Outlets.CPP.Block._parent.instanceRemoved.apply(this, arguments);
    //     for(var i = 0; i < this.gotoLinks.length; ++i){
    //         this.gotoLinks[i].html(">>").css("visibility", "hidden");
    //     }
    // },

    // _act: mixin({}, Outlets.CPP.Code._act, {

    //     index: function(msg){
    //         this.gotoLinks[msg.data].html("<<");
    //         //this.gotoLinks[msg.data].css("visibility", "hidden");
    //     }

    // }, true)
}


// Lobster.Outlets.CPP.OpaqueFunctionBodyBlock = Outlets.CPP.Code.extend({
//     _name: "Outlets.CPP.OpaqueFunctionBodyBlock",

//     createElement: function(){
//         this.element.removeClass("codeInstance");
//         this.element.addClass("braces");
//         this.element.append(curlyOpen);
//         this.element.append("<br />");
//         var inner = this.innerElem = $("<span class=\"inner\"><span class=\"highlight\"></span></span>");
//         inner.addClass("block");
//         this.element.append(inner);
//         var lineElem = $('<span class="blockLine">// Implementation not shown</span>');
//         inner.append(lineElem);
//         inner.append("<br />");
//         this.element.append("<br />");
//         this.element.append(curlyClose);
//     }
// });

export class StatementOutlet<RTConstruct_type extends RuntimeStatement = RuntimeStatement> extends ConstructOutlet<RTConstruct_type> {

    public constructor(element: JQuery, construct: RTConstruct_type["model"], parent?: ConstructOutlet) {
        super(element, construct, parent);
        this.element.addClass("statement");
    }

    // TODO: I don't think this is important, so it should probably be removed
    // // Statements get reset after being popped
    // setInstance : function(inst){
    //     if (inst.isActive){
    //         Outlets.CPP.Statement._parent.setInstance.apply(this, arguments);
    //     }
    // }
    
    @messageResponse("reset")
    private reset() {
        this.removeInstance();
    }

}

export class DeclarationStatementOutlet extends StatementOutlet<RuntimeDeclarationStatement> {

    public readonly initializerOutlets: readonly (InitializerOutlet | undefined)[] = [];

    private declaratorElems : JQuery[] = [];
    private currentDeclarationIndex : number | null = null;

    public constructor(element: JQuery, construct: CompiledDeclarationStatement, parent?: ConstructOutlet) {
        super(element, construct, parent);

        let declarationElem = $("<span></span>")

        declarationElem.addClass("codeInstance");
        declarationElem.addClass("declaration");
        declarationElem.append(htmlDecoratedType(this.construct.declarations[0].type));
        declarationElem.append(" ");

        this.construct.declarations.forEach((declaration, i) => {

            // Create element for declarator
            let declElem = $('<span class="codeInstance code-declarator"><span class="highlight"></span></span>');
            this.declaratorElems.push(declElem);
            declElem.append(declaration.type.declaratorString(htmlDecoratedName(declaration.name, declaration.type)));
            declarationElem.append(declElem);

            // Create element for initializer, if there is one
            if(declaration.initializer) {
                asMutable(this.initializerOutlets).push(
                    createInitializerOutlet($("<span></span>").appendTo(declarationElem), declaration.initializer, this)
                );
            }
            else {
                asMutable(this.initializerOutlets).push(undefined);
            }

            // Add commas where needed
            if (i < this.construct.declarations.length - 1) {
                declarationElem.append(", ");
            }
        });

        this.element.append(declarationElem);
        this.element.append(";");
    }

    protected instanceRemoved() {

    }

    private setCurrentDeclarationIndex(current: number | null) {

        // Remove from previous current
        if (this.currentDeclarationIndex !== null) {
            this.declaratorElems[this.currentDeclarationIndex].removeClass("active");
        }

        // Set new or set to null
        this.currentDeclarationIndex = current;
        if (current !== null) {
            this.declaratorElems[current].addClass("active");
        }
    }

    @messageResponse("initializing")
    private initializing(msg: Message<number>) {
        this.setCurrentDeclarationIndex(msg.data);
    }
}

export class ExpressionStatementOutlet extends StatementOutlet<RuntimeExpressionStatement> {

    public readonly expression: ExpressionOutlet;

    public constructor(element: JQuery, construct: CompiledExpressionStatement, parent?: ConstructOutlet) {
        super(element, construct, parent);

        let elem = $("<span></span>")
        this.expression = createExpressionOutlet(elem, this.construct.expression, this);
        this.element.append(elem);
        this.element.append(";");
    }

}

export class NullStatementOutlet extends StatementOutlet<RuntimeNullStatement> {

    public constructor(element: JQuery, construct: CompiledNullStatement, parent?: ConstructOutlet) {
        super(element, construct, parent);

        this.element.append(";");
    }

}

export class IfStatementOutlet extends StatementOutlet<RuntimeIfStatement> {
    
    public readonly condition: ExpressionOutlet;
    public readonly then: StatementOutlet;
    public readonly otherwise?: StatementOutlet;

    public constructor(element: JQuery, construct: CompiledIfStatement, parent?: ConstructOutlet) {
        super(element, construct, parent);

        this.element.addClass("selection");

        this.element.append(htmlDecoratedKeyword("if"));
        this.element.append('(');

        let ifElem = $("<span></span>");
        this.condition = createExpressionOutlet(ifElem, this.construct.condition, this);
        this.element.append(ifElem);

        this.element.append(") ");

        let thenElem = $("<span></span>");
        this.then = createStatementOutlet(thenElem, this.construct.then, this);
        this.element.append(thenElem);

        if (this.construct.otherwise){
            this.element.append("<br />");
            this.element.append(htmlDecoratedKeyword("else"));
            this.element.append(" ");
            let elseElem = $("<span></span>");
            this.otherwise = createStatementOutlet(elseElem, this.construct.otherwise, this);
            this.element.append(elseElem);
        }
    }
}

export class WhileStatementOutlet extends StatementOutlet<RuntimeWhileStatement> {
    
    public readonly condition: ExpressionOutlet;
    public readonly body: StatementOutlet;

    public constructor(element: JQuery, construct: CompiledWhileStatement, parent?: ConstructOutlet) {
        super(element, construct, parent);

        this.element.addClass("code-while");

        this.element.append(htmlDecoratedKeyword("while"));
        this.element.append("(");

        var condElem = $("<span></span>");
        this.condition = createExpressionOutlet(condElem, this.construct.condition, this);
        this.element.append(condElem);

        this.element.append(") ");

        var bodyElem = $("<span></span>");
        this.body = createStatementOutlet(bodyElem, this.construct.body, this);
        this.element.append(bodyElem);
    }
}

// Lobster.Outlets.CPP.DoWhile = Outlets.CPP.Statement.extend({
//     _name: "Outlets.CPP.DoWhile",

//     init: function(element, code, simOutlet){
//         this.initParent(element, code, simOutlet);
//         this.element.addClass("code-doWhile");
//     },

//     createElement: function(){
//         this.element.append(htmlDecoratedKeyword("do"));

//         var bodyElem = $("<span></span>")
//         this.addChildOutlet(this.body = createCodeOutlet(bodyElem, this.construct.body, this.simOutlet));
//         this.element.append(bodyElem);

//         this.element.append("\n" + htmlDecoratedKeyword("while") + "(");

//         var condElem = $("<span></span>")
//         this.addChildOutlet(this.condition = createCodeOutlet(condElem, this.construct.condition, this.simOutlet));
//         this.element.append(condElem);

//         this.element.append(") ");


//     },

//     _act: $.extend({}, Outlets.CPP.Statement._act, {
//         reset: function(){
//             this.condition.removeInstance();
//             this.body.removeInstance();
//         }
//     })
// });



export class ForStatementOutlet extends StatementOutlet<RuntimeForStatement> {

    public readonly initial: StatementOutlet;
    public readonly condition: ExpressionOutlet;
    public readonly post: ExpressionOutlet;
    public readonly body: StatementOutlet;

    public constructor(element: JQuery, construct: CompiledForStatement, parent?: ConstructOutlet) {
        super(element, construct, parent);

        this.element.addClass("code-for");

        this.element.append(htmlDecoratedKeyword("for"));
        this.element.append("(");

        var initElem = $("<span></span>");
        this.initial = createStatementOutlet(initElem, this.construct.initial, this);
        this.element.append(initElem);

        this.element.append(" ");

        var condElem = $("<span></span>");
        this.condition = createExpressionOutlet(condElem, this.construct.condition, this);
        this.element.append(condElem);

        this.element.append("; ");

        var postElem = $("<span></span>");
        this.post = createExpressionOutlet(postElem, this.construct.post, this);
        this.element.append(postElem);

        this.element.append(") ");

        var bodyElem = $("<span></span>");
        this.body = createStatementOutlet(bodyElem, this.construct.body, this);
        this.element.append(bodyElem);

    }
}

export class ReturnStatementOutlet extends StatementOutlet<RuntimeReturnStatement> {

    public readonly args: readonly ExpressionOutlet[];
    public readonly expression?: ExpressionOutlet;

    public constructor(element: JQuery, construct: CompiledReturnStatement, parent?: ConstructOutlet) {
        super(element, construct, parent);
        this.element.addClass("return");
        this.args = [];
        this.element.append('<span class="code-keyword">return</span>');

        let exprElem = $("<span></span>");
        if (this.construct.returnInitializer) {
            this.element.append(" ");
            asMutable(this.args).push(this.expression = createExpressionOutlet(exprElem, this.construct.returnInitializer.args[0], this));
        }
        this.element.append(exprElem);

        this.element.append(";");
    }

    // _act : mixin({}, Outlets.CPP.Code._act, {
    //     returned: function(msg){
    //         var data = msg.data;

    //         // If it's main just return
    //         if (this.construct.containingFunction().isMain){
    //             return;
    //         }

    //         if (this.expr) {
    //             this.inst.containingRuntimeFunction().parent.send("returned", this.args[0]);
    //         }

    //     }
    // }),

}

// Lobster.Outlets.CPP.Break = Outlets.CPP.Statement.extend({
//     _name: "Outlets.CPP.Break",

//     init: function(element, code, simOutlet){
//         this.initParent(element, code, simOutlet);
//         this.element.addClass("break");

//         this.element.append(htmlDecoratedKeyword("break"));
//         this.element.append(";");
//     },

//     createElement: function(){}
// });



export class ParameterOutlet {

    private readonly element: JQuery;
    private readonly passedValueElem: JQuery;

    public constructor(element: JQuery, paramDef: CompiledParameterDefinition) {
        this.element = element;

        this.element.addClass("codeInstance");
        this.element.addClass("declaration");
        this.element.addClass("parameter");

        this.element.append(this.passedValueElem = $("<div> </div>"));

        this.element.append(paramDef.type.typeString(false, htmlDecoratedName(paramDef.name, paramDef.type), true));

    }

    // _act: copyMixin(Outlets.CPP.Code._act, {
    //     initialized : function(msg){
    //         var obj = msg.data;
    //         var val;
    //         if (isA(obj, ReferenceEntityInstance)){
    //             val = "@"+obj.refersTo.nameString(); // TODO make a different animation for reference binding
    //         }
    //         else{
    //             val = obj.valueString();
    //         }
    //         val = Util.htmlDecoratedValue(val);
    //         var argOutlet = this.inst.identify("idArgOutlet");
    //         if (argOutlet && argOutlet.simOutlet === this.simOutlet){
    //             var self = this;
    //             this.simOutlet.valueTransferOverlay(argOutlet, this, val, 500, function(){
    //                 // I decided that the parameter text shouldn't change. It already changes in memory display.
    //                 // Changed my mind again. Now it does display underneath.
    //                 self.passedValueElem.html(val);
    //             });
    //         }
    //         else{
    //             this.passedValueElem.html(val);
    //         }
    //     }
    // })
}


// export class Initializer<RTInitializer_type extends RuntimeInitializer = RuntimeInitializer> extends ConstructOutlet<RTInitializer_type> {

//     public constructor(element: JQuery, construct: RTInitializer_type["model"], parent?: ConstructOutlet) {
//         super(element, construct, parent);

//         this.element.addClass("code-initializer");

//         var exprElem = $("<span></span>");
//         this.element.append(exprElem);
//         this.arg = createCodeOutlet(exprElem, this.construct.initExpr, this.simOutlet);
//     }

//     // _act : copyMixin(Outlets.CPP.Code._act, {
//     //     "idArgOutlet" : Observer._IDENTIFY
//     // })
// }

// Lobster.Outlets.CPP.InitializerList = Outlets.CPP.Code.extend({
//     _name: "Outlets.CPP.InitializerList",

//     init: function (element, code, simOutlet) {
//         this.initParent(element, code, simOutlet);
//         this.element.addClass("code-initializerList");

//         this.element.append("{");

//         for (var i = 0; i < this.construct.initializerListLength; ++i) {
//             var argElem = $("<span></span>");
//             createCodeOutlet(argElem, this.code["arg"+i], this);
//             this.element.append(argElem);
//             if (i < this.construct.initializerListLength - 1) {
//                 this.element.append(", ");
//             }
//         }

//         this.element.append("}");
//     },
//     _act : copyMixin(Outlets.CPP.Code._act, {
//         "idArgOutlet" : Observer._IDENTIFY
//     })
// });


export class InitializerOutlet<RT extends RuntimeInitializer = RuntimeInitializer> extends PotentialFullExpressionOutlet<RT> {
    
    public constructor(element: JQuery, construct: CompiledInitializer, parent?: ConstructOutlet) {
        super(element, construct, parent);
    }
    
}


export class DefaultInitializerOutlet extends InitializerOutlet<RuntimeDefaultInitializer> {
    
    public constructor(element: JQuery, construct: CompiledDefaultInitializer, parent?: ConstructOutlet) {
        super(element, construct, parent);
        this.element.addClass("code-defaultInitializer");
    }
    
}

export class AtomicDefaultInitializerOutlet extends InitializerOutlet<RuntimeAtomicDefaultInitializer> {
    
    // Nothing to add based on being atomic
    
}

export class ArrayDefaultInitializerOutlet extends InitializerOutlet<RuntimeArrayDefaultInitializer> {
    
    public readonly elementInitializerOutlets?: readonly InitializerOutlet[];

    public constructor(element: JQuery, construct: CompiledArrayDefaultInitializer, parent?: ConstructOutlet) {
        super(element, construct, parent);

        if (this.construct.elementInitializers) {
            this.elementInitializerOutlets = this.construct.elementInitializers.map(
                elemInit => createInitializerOutlet(element, elemInit, this)
            );
        }
    }
    
}

// export class ClassDefaultInitializerOutlet extends InitializerOutlet<RuntimeClassDefaultInitializer> {
    
//     public constructor(element: JQuery, construct: CompiledClassDefaultInitializer, parent?: ConstructOutlet) {
//         super(element, construct, parent);

//         this.addChildOutlet(Outlets.CPP.FunctionCall.instance(this.construct.funcCall, this, this.argOutlets));
//     }
    
// }


export class DirectInitializerOutlet extends InitializerOutlet<RuntimeDirectInitializer> {
    
    public constructor(element: JQuery, construct: CompiledDirectInitializer, parent?: ConstructOutlet) {
        super(element, construct, parent);
        this.element.addClass("code-directInitializer");
    }
}

export class AtomicDirectInitializerOutlet extends InitializerOutlet<RuntimeAtomicDirectInitializer> {
    
    public readonly argOutlet: ExpressionOutlet;

    public constructor(element: JQuery, construct: CompiledAtomicDirectInitializer, parent?: ConstructOutlet) {
        super(element, construct, parent);
    
        this.element.append("(");
        this.argOutlet = createExpressionOutlet($("<span></span>").appendTo(this.element), construct.arg, this);
        this.element.append(")");

    }
    
}


export class ReferenceDirectInitializerOutlet extends InitializerOutlet<RuntimeReferenceDirectInitializer> {
    
    public readonly argOutlet: ExpressionOutlet;

    public constructor(element: JQuery, construct: CompiledReferenceDirectInitializer, parent?: ConstructOutlet) {
        super(element, construct, parent);
    
        this.element.append("(");
        this.argOutlet = createExpressionOutlet($("<span></span>").appendTo(this.element), construct.arg, this);
        this.element.append(")");

    }
    
}


// export class ClassDirectInitializerOutlet extends InitializerOutlet<RuntimeClassDirectInitializer> {
    
//     public readonly argOutlets: readonly ExpressionOutlet[];

//     public constructor(element: JQuery, construct: CompiledClassDirectInitializer, parent?: ConstructOutlet) {
//         super(element, construct, parent);
    
//         this.element.append("(");

//         var callOutlet = Outlets.CPP.FunctionCall.instance(this.construct.funcCall, this, this.argOutlets);
//             this.addChildOutlet(callOutlet);

//             this.argOutlets = callOutlet.argOutlets;
//             this.argOutlets.forEach(function(argOutlet,i,arr){
//                 self.addChildOutlet(argOutlet);
//                 self.element.append(argOutlet.element);
//                 if (i < arr.length - 1) {
//                     self.element.append(", ");
//                 }
//             });

//         this.element.append(")");
//     }
// }



export abstract class CopyInitializerOutlet extends InitializerOutlet<RuntimeCopyInitializer> {
    
    public constructor(element: JQuery, construct: CompiledCopyInitializer, parent?: ConstructOutlet) {
        super(element, construct, parent);
        this.element.addClass("code-copyInitializer");
    }
}

export class AtomicCopyInitializerOutlet extends InitializerOutlet<RuntimeAtomicCopyInitializer> {
    
    public readonly argOutlet: ExpressionOutlet;

    public constructor(element: JQuery, construct: CompiledAtomicCopyInitializer, parent?: ConstructOutlet) {
        super(element, construct, parent);
    
        this.element.append(" = ");
        this.argOutlet = createExpressionOutlet($("<span></span>").appendTo(this.element), construct.arg, this);
    }
    
}

export class ReferenceCopyInitializerOutlet extends InitializerOutlet<RuntimeReferenceCopyInitializer> {
    
    public readonly argOutlet: ExpressionOutlet;

    public constructor(element: JQuery, construct: CompiledReferenceCopyInitializer, parent?: ConstructOutlet) {
        super(element, construct, parent);
    
        this.element.append(" = ");
        this.argOutlet = createExpressionOutlet($("<span></span>").appendTo(this.element), construct.arg, this);
    }
    
}


// export class ClassDirectInitializerOutlet extends InitializerOutlet<RuntimeClassDirectInitializer> {
    
//     public readonly argOutlets: readonly ExpressionOutlet[];

//     public constructor(element: JQuery, construct: CompiledClassDirectInitializer, parent?: ConstructOutlet) {
//         super(element, construct, parent);
    
//         this.element.append("(");

//         var callOutlet = Outlets.CPP.FunctionCall.instance(this.construct.funcCall, this, this.argOutlets);
//             this.addChildOutlet(callOutlet);

//             this.argOutlets = callOutlet.argOutlets;
//             this.argOutlets.forEach(function(argOutlet,i,arr){
//                 self.addChildOutlet(argOutlet);
//                 self.element.append(argOutlet.element);
//                 if (i < arr.length - 1) {
//                     self.element.append(", ");
//                 }
//             });

//         this.element.append(")");
//     }
// }

export abstract class ExpressionOutlet<RT extends RuntimeExpression = RuntimeExpression> extends PotentialFullExpressionOutlet<RT> {
    
    public readonly showingEvalResult: boolean = false;
    
    protected readonly evalResultElem: JQuery;
    protected readonly wrapperElem: JQuery;
    protected readonly exprElem: JQuery;

    public constructor(element: JQuery, construct: RT["model"], parent?: ConstructOutlet) {
        super(element, construct, parent);

        this.element.addClass("expression");
        if (this.construct.isFullExpression()) {this.element.addClass("fullExpression");}

        this.evalResultElem = $("<span class='lobster-hidden-expression' style='opacity:0'></span>"); // TODO fix this ugly hack
        this.wrapperElem = $("<span class='lobster-expression-wrapper'></span>");
        this.exprElem = $("<span class='expr'></span>"); // TODO fix this ugly hack
        this.wrapperElem.append(this.exprElem);
        this.wrapperElem.append(this.evalResultElem);

        this.element.append(this.wrapperElem);

        this.element.append("<span class='exprType'>" + this.construct.type.toString() + "</span>");

    }

    private setEvalResult(result: RT["evalResult"], suppressAnimation: boolean = false) {
        (<Mutable<this>>this).showingEvalResult = true;

        if (result instanceof CPPObject || result instanceof FunctionEntity) {
            this.evalResultElem.html(result.describe().name);
            this.evalResultElem.addClass("lvalue");
        }
        else if (result instanceof Value) {  // result.isA(Value)
            this.evalResultElem.html(result.valueString());
            this.evalResultElem.addClass("rvalue");
            if (!result.isValid) {
                this.evalResultElem.addClass("invalid");
            }
        }
        else {
            assertFalse("unexpected evalResult type for expression outlet");
        }

        if(CODE_ANIMATIONS && !suppressAnimation) {
            this.wrapperElem.animate({
                width: this.evalResultElem.css("width")
            }, 500, function () {
                $(this).css("width", "auto");
            });
        }

        this.evalResultElem.removeClass("lobster-hidden-expression").fadeTo(EVAL_FADE_DURATION, 1);
        this.exprElem.addClass("lobster-hidden-expression").fadeTo(EVAL_FADE_DURATION, 0);
    }

    private removeEvalValue() {
        (<Mutable<this>>this).showingEvalResult = false;
//        if(CODE_ANIMATIONS) {
//            this.wrapperElem.animate({
//                width: this.exprElem.css("width")
//            }, 500, function () {
//                $(this).css("width", "auto");
//            });
////                this.evalResultElem.animate({
////                    width: this.evalResultElem.css("width")
////                }, 500, function () {
////                    $(this).css("width", "auto");
////                });
//        }
        //setTimeout(function() {
            this.exprElem.removeClass("lobster-hidden-expression").fadeTo(RESET_FADE_DURATION, 1);
            this.evalResultElem.addClass("lobster-hidden-expression").fadeTo(RESET_FADE_DURATION, 0);

            this.element.removeClass("rvalue");
            this.element.removeClass("lvalue");
            this.wrapperElem.css("width", "auto");
        //}, 2000);
    }

    protected instanceSet(inst: RT) {
        if (inst.evalResult) {
            this.setEvalResult(inst.evalResult, true);
        }
        else{
            this.removeEvalValue();
        }
    }

    protected instanceRemoved() {
        this.removeEvalValue();
    }

    @messageResponse("evaluated")
    private evaluated(msg: Message<RT["evalResult"]>) {
        this.setEvalResult(msg.data);
    }
}

const ASSIGNMENT_OP_HTML = htmlDecoratedOperator("=", "code-assignmentOp");

export class AssignmentExpressionOutlet extends ExpressionOutlet<RuntimeAssignment> {

    public readonly lhs: ExpressionOutlet;
    public readonly rhs: ExpressionOutlet;

    public constructor(element: JQuery, construct: CompiledAssignment, parent?: ConstructOutlet) {
        super(element, construct, parent);

        this.element.addClass("assignment");

        let lhsElem = $("<span></span>").appendTo(this.exprElem);
        this.lhs = createExpressionOutlet(lhsElem, this.construct.lhs, this);

        this.exprElem.append(" " + ASSIGNMENT_OP_HTML + " ");

        let rhsElem = $("<span></span>").appendTo(this.exprElem);
        this.rhs = createExpressionOutlet(rhsElem, this.construct.rhs, this);


        // if (this.construct.funcCall){
        //     var callOutlet = Outlets.CPP.FunctionCall.instance(this.construct.funcCall, this);
        //     this.addChildOutlet(callOutlet);

        //     this.argOutlets = callOutlet.argOutlets;
        //     this.argOutlets.forEach(function(argOutlet,i,arr){
        //         self.addChildOutlet(argOutlet);
        //         self.exprElem.append(argOutlet.element);
        //         if (i < arr.length - 1) {
        //             self.exprElem.append(", ");
        //         }
        //     });
        // }
    }

//     _act: mixin({}, Outlets.CPP.Expression._act, {

//         returned: function(msg){
//             var value = msg.data;
//             this.setEvalResult(value);

// //            if(CODE_ANIMATIONS) {
// //                this.wrapperElem.animate({
// //                    width: this.evalResultElem.css("width")
// //                }, 500, function () {
// //                    $(this).css("width", "auto");
// //                });
// //            }

//             this.evalResultElem.removeClass("lobster-hidden-expression").fadeTo(EVAL_FADE_DURATION, 1);
//             this.exprElem.addClass("lobster-hidden-expression").fadeTo(EVAL_FADE_DURATION, 0);

// //            console.log("expression evaluated to " + value.value);
//         }

//     }, true)
}

const TERNARY_OP_HTML1 = htmlDecoratedOperator("?", "code-ternaryOp");
const TERNARY_OP_HTML2 = htmlDecoratedOperator(":", "code-ternaryOp");


export class TernaryExpressionOutlet extends ExpressionOutlet<RuntimeTernary> {

    public readonly condition: ExpressionOutlet;
    public readonly then: ExpressionOutlet;
    public readonly otherwise: ExpressionOutlet;

    public constructor(element: JQuery, construct: CompiledTernary, parent?: ConstructOutlet) {
        super(element, construct, parent);

        this.element.addClass("code-ternary");

        let elem = $("<span></span>");
        this.condition = createExpressionOutlet(elem, this.construct.condition, this);
        this.exprElem.append(elem);

        this.exprElem.append(" " + TERNARY_OP_HTML1 + " ");

        elem = $("<span></span>");
        this.then = createExpressionOutlet(elem, this.construct.then, this);
        this.exprElem.append(elem);

        this.exprElem.append(" " + TERNARY_OP_HTML2 + " ");

        elem = $("<span></span>");
        this.otherwise = createExpressionOutlet(elem, this.construct.otherwise, this);
        this.exprElem.append(elem);
    }
}

const COMMA_OP_HTML = htmlDecoratedOperator(",", "code-binaryOp");

export class CommaExpressionOutlet extends ExpressionOutlet<RuntimeComma> {
    
    public readonly left: ExpressionOutlet;
    public readonly right: ExpressionOutlet;

    public constructor(element: JQuery, construct: CompiledComma, parent?: ConstructOutlet) {
        super(element, construct, parent);

        this.element.addClass("code-comma");

        let elem = $("<span></span>");
        this.left = createExpressionOutlet(elem, this.construct.left, this);
        this.exprElem.append(elem);

        this.exprElem.append(" " + COMMA_OP_HTML + " ");

        elem = $("<span></span>");
        this.right = createExpressionOutlet(elem, this.construct.right, this);
        this.exprElem.append(elem);
    }
}

// Lobster.Outlets.CPP.CompoundAssignment = Outlets.CPP.Expression.extend({
//     _name: "Outlets.CPP.CompoundAssignment",

//     init: function(element, code, simOutlet){
//         this.initParent(element, code, simOutlet);
//         this.element.addClass("compoundAssignment");

//         //let lhsElem = $("<span></span>");
//         //createCodeOutlet(lhsElem, this.construct.rhs.left, this);
//         //this.exprElem.append(lhsElem);
//         //
//         //this.exprElem.append(" " + htmlDecoratedOperator(this.construct.operator, "code-compoundAssignmentOp") + " ");

//         let rhsElem = $("<span></span>");
//         let rhsOutlet = createCodeOutlet(rhsElem, this.construct.rhs, this.simOutlet);
//         this.addChildOutlet(rhsOutlet);
//         this.exprElem.append(rhsElem);
//         rhsElem.find(".code-binaryOp").first().replaceWith(htmlDecoratedOperator(this.construct.operator, "code-compoundAssignmentOp"));
//     }
// });

// export class FunctionCallOutlet extends ConstructOutlet<RuntimeFunctionCall> {

//     // public readonly returnOutlet;
//     public readonly functionOutlet?: FunctionOutlet;
//     public readonly argOutlets: readonly CopyInitializerOutlet[];

//     public constructor(element: JQuery, construct: CompiledFunctionCall, parent?: ConstructOutlet) {
//         super(element, construct, parent);
        
//         // this.returnOutlet = returnOutlet;

//         this.argOutlets = this.construct.argInitializers.map((argInit) => 
//             new CopyInitializerOutlet($("<span></span>"), argInit)
//         );
//     }

//     // protected instanceSet(inst: RuntimeFunctionCall) {
//     //     inst.calledFunction.isActive
//     //     if (this.inst.hasBeenCalled && this.inst.func.isActive) {
//     //         var funcOutlet = this.simOutlet.pushFunction(this.inst.func, this);
//     //         funcOutlet && this.listenTo(funcOutlet);
//     //     }
//     // }

//     // _act: mixin({}, Outlets.CPP.Code._act, {

//     //     returned: function(msg){
//     //         // This may be the case for main, constructors, destructors, etc.
//     //         if (!this.returnOutlet){
//     //             return;
//     //         }
//     //         var sourceOutlet = msg.data;

//     //         var self = this;
//     //         var data = sourceOutlet.inst && sourceOutlet.inst.childInstances && sourceOutlet.inst.childInstances.args && sourceOutlet.inst.childInstances.args[0] && sourceOutlet.inst.childInstances.args[0].evalResult;
//     //         if (!data){
//     //             return;
//     //         }
//     //         this.simOutlet.valueTransferOverlay(sourceOutlet, this.returnOutlet, Util.htmlDecoratedValue(data.instanceString()), 500,
//     //             function () {
//     //                 if(self.returnOutlet) { // may have evaporated if we're moving too fast
//     //                     self.returnOutlet.setEvalResult(data);
//     //                 }
//     //             });
//     //     },
//     //     tailCalled : function(msg){
//     //         var callee = msg.data;
//     //         callee.send("tailCalled", this);
//     //     },
//     //     called : function(msg){
//     //         var callee = msg.data;
//     //         assert(this.simOutlet);
//     //         if (!this.simOutlet.simOutlet.autoRunning || !this.simOutlet.simOutlet.skipFunctions){
//     //             var funcOutlet = this.simOutlet.pushFunction(this.inst.func, this);
//     //             funcOutlet && this.listenTo(funcOutlet);
//     //         }
//     //     }
//     // }, true)
// }

export class FunctionCallExpressionOutlet extends ExpressionOutlet<RuntimeFunctionCallExpression> {

    public readonly argOutlets: readonly ExpressionOutlet[];
    
    public constructor(element: JQuery, construct: CompiledFunctionCallExpression, parent?: ConstructOutlet) {
        super(element, construct, parent);
        this.element.addClass("functionCall");

        // if (this.construct.funcCall.func.isVirtual()){
        //     this.element.addClass("virtual");
        // }

        // if (this.construct.recursiveStatus === "recursive" && this.construct.isTail) {
        //     this.element.addClass("tail");
        // }

        createExpressionOutlet($("<span></span>").appendTo(this.exprElem), this.construct.operand, this);

        this.exprElem.append("(");


        this.argOutlets = this.construct.args.map((argInit, i) => {
            if (i > 0) {
                this.exprElem.append(", ");
            }
            return createExpressionOutlet($("<span></span>").appendTo(this.exprElem), argInit, this)
        });

        this.exprElem.append(")");
        // if (this.construct.funcCall.func.isVirtual()){
        //     this.exprElem.append("<sub>v</sub>");
        // }
    }

//     _act: mixin({}, Outlets.CPP.Expression._act, {

// //        calleeOutlet : function(callee, source){
// //            this.addChildOutlet(callee);
// //        },

//         returned: function(msg){
//             var value = msg.data;
//             this.setEvalResult(value);

//             this.evalResultElem.removeClass("lobster-hidden-expression");
//             this.exprElem.addClass("lobster-hidden-expression");
//         },
//         tailCalled : function(msg){
//             var callee = msg.data;
//             callee.send("tailCalled", this);
//         }

//     }, true)
}



export class MagicFunctionCallExpressionOutlet extends ExpressionOutlet<RuntimeMagicFunctionCallExpression> {

    public readonly argOutlets: readonly ExpressionOutlet[];
    
    public constructor(element: JQuery, construct: CompiledMagicFunctionCallExpression, parent?: ConstructOutlet) {
        super(element, construct, parent);
        this.element.addClass("functionCall");

        this.exprElem.append(this.construct.functionName + "(");

        this.argOutlets = this.construct.args.map((argInit, i) => {
            if (i > 0) {
                this.exprElem.append(", ");
            }
            return createExpressionOutlet($("<span></span>").appendTo(this.exprElem), argInit, this)
        });

        this.exprElem.append(")");
        // if (this.construct.funcCall.func.isVirtual()){
        //     this.exprElem.append("<sub>v</sub>");
        // }
    }

//     _act: mixin({}, Outlets.CPP.Expression._act, {

// //        calleeOutlet : function(callee, source){
// //            this.addChildOutlet(callee);
// //        },

//         returned: function(msg){
//             var value = msg.data;
//             this.setEvalResult(value);

//             this.evalResultElem.removeClass("lobster-hidden-expression");
//             this.exprElem.addClass("lobster-hidden-expression");
//         },
//         tailCalled : function(msg){
//             var callee = msg.data;
//             callee.send("tailCalled", this);
//         }

//     }, true)
}


export class BinaryOperatorExpressionOutlet extends ExpressionOutlet<RuntimeBinaryOperator> {

    public readonly left: ExpressionOutlet;
    public readonly right: ExpressionOutlet;

    public constructor(element: JQuery, construct: CompiledBinaryOperator,
        parent?: ConstructOutlet) {
        super(element, construct, parent);

        // if (this.construct.funcCall){
        //     var callOutlet = Outlets.CPP.FunctionCall.instance(this.construct.funcCall, this);
        //     this.addChildOutlet(callOutlet);

        //     this.argOutlets = callOutlet.argOutlets;

        //     // If it's a member function call there will only be one argument and we need to add the left
        //     if (this.construct.isMemberOverload){
        //         var elem = $("<span></span>");
        //         createCodeOutlet(elem, this.construct.left, this);
        //         this.exprElem.append(elem);
        //         this.exprElem.append(" " + htmlDecoratedOperator(this.construct.operator, "code-binaryOp") + " ");
        //     }

        //     var self = this;
        //     this.argOutlets.forEach(function(argOutlet,i,arr){
        //         self.addChildOutlet(argOutlet);
        //         self.exprElem.append(argOutlet.element);
        //         if (i < arr.length - 1) {
        //             self.exprElem.append(" " + self.code.operator + " ");
        //         }
        //     });
        // }
        this.left = createExpressionOutlet($("<span></span>").appendTo(this.exprElem), this.construct.left, this);
        this.exprElem.append(" <span class='codeInstance code-binaryOp'>" + this.construct.operator + "<span class='highlight'></span></span> ");
        this.right = createExpressionOutlet($("<span></span>").appendTo(this.exprElem), this.construct.right, this);
    }
}

export class UnaryOperatorExpressionOutlet extends ExpressionOutlet<RuntimeUnaryOperator> {

    public readonly operand: ExpressionOutlet;

    public constructor(element: JQuery, construct: CompiledUnaryOperator, parent?: ConstructOutlet) {
        super(element, construct, parent);

        this.exprElem.append(htmlDecoratedOperator(this.construct.operator, "code-unaryOp"));

        // if (this.construct.funcCall) {
        //     var callOutlet = Outlets.CPP.FunctionCall.instance(this.construct.funcCall, this);
        //     this.addChildOutlet(callOutlet);
        //     this.argOutlets = callOutlet.argOutlets;

        //     // If it's a member function call there will be no arguments and we need to add the operand
        //     if (this.construct.isMemberOverload) {
        //         var elem = $("<span></span>");
        //         createCodeOutlet(elem, this.construct.operand, this);
        //         this.exprElem.append(elem)
        //     }
        //     else{
        //         this.addChildOutlet(this.argOutlets[0]);
        //         this.exprElem.append(this.argOutlets[0].element);
        //     }
        // }
        // else{
            this.operand = createExpressionOutlet($("<span></span>").appendTo(this.exprElem), this.construct.operand, this);
        // }
    }
}

// Lobster.Outlets.CPP.NewExpression = Outlets.CPP.Expression.extend({
//     _name: "Outlets.CPP.NewExpression",

//     init: function(element, code, simOutlet){
//         this.initParent(element, code, simOutlet);

//         this.element.addClass("code-newExpression");
//         this.exprElem.append(htmlDecoratedOperator("new", "code-unaryOp"));
//         this.exprElem.append(" ");

//         if (isA(this.construct.heapType, Types.Array) && this.construct.dynamicLength){
//             this.exprElem.append(this.construct.heapType.elemType.typeString(false, '[<span class="dynamicLength"></span>]'));
//             createCodeOutlet(this.exprElem.find(".dynamicLength"), this.construct.dynamicLength, this);
//         }
//         else{
//             this.exprElem.append(htmlDecoratedType(this.construct.heapType));
//         }

//         if (this.construct.initializer) {
//             var initElem = $("<span></span>");
//             createCodeOutlet(initElem, this.construct.initializer, this);
//             this.exprElem.append(initElem);
//         }


//     },
//     upNext: function(){
//         Outlets.CPP.Expression.upNext.apply(this, arguments);
//         var temp = this.element.find(".code-unaryOp").first().addClass("upNext");
// //        console.log("upNext for " + this.construct.code.text);
//     }
// });

// Lobster.Outlets.CPP.Delete = Outlets.CPP.Expression.extend({
//     _name: "Outlets.CPP.Delete",

//     init: function(element, code, simOutlet){
//         this.initParent(element, code, simOutlet);

//         this.element.addClass("code-delete");
//         this.exprElem.append(htmlDecoratedOperator("delete", "code-unaryOp"));
//         this.exprElem.append(" ");
//         var operandElem = $("<span></span>");
//         createCodeOutlet(operandElem, this.construct.operand, this);
//         this.exprElem.append(operandElem);

//         if (this.construct.funcCall){
//             var callOutlet = Outlets.CPP.FunctionCall.instance(this.construct.funcCall, this, []);
//             this.addChildOutlet(callOutlet);
//         }
//     }
// });


// Lobster.Outlets.CPP.DeleteArray = Outlets.CPP.Expression.extend({
//     _name: "Outlets.CPP.DeleteArray",

//     init: function(element, code, simOutlet){
//         this.initParent(element, code, simOutlet);

//         this.element.addClass("code-deleteArray");
//         this.exprElem.append(htmlDecoratedOperator("delete[]", "code-unaryOp"));
//         this.exprElem.append(" ");
//         var operandElem = $("<span></span>");
//         createCodeOutlet(operandElem, this.construct.operand, this);
//         this.exprElem.append(operandElem);


//     }
// });



// Lobster.Outlets.CPP.ConstructExpression = Outlets.CPP.Expression.extend({
//     _name: "Outlets.CPP.ConstructExpression",

//     init: function(element, code, simOutlet){
//         this.initParent(element, code, simOutlet);

//         this.element.addClass("code-constructExpression");
//         this.exprElem.append(htmlDecoratedType(this.construct.type));

//         if (this.construct.initializer) {
//             var initElem = $("<span></span>");
//             createCodeOutlet(initElem, this.construct.initializer, this);
//             this.exprElem.append(initElem);
//         }
//     }
// });

// Lobster.Outlets.CPP.Increment = Outlets.CPP.Expression.extend({
//     _name: "Outlets.CPP.Increment",

//     init: function(element, code, simOutlet){
//         this.initParent(element, code, simOutlet);

//         var operandElem = $("<span></span>");
//         createCodeOutlet(operandElem, this.construct.operand, this);
//         this.exprElem.append(operandElem);

//         this.exprElem.append(htmlDecoratedOperator("++", "code-postfixOp"));
//     }
// });
// Lobster.Outlets.CPP.Decrement = Outlets.CPP.Expression.extend({
//     _name: "Outlets.CPP.Decrement",

//     init: function(element, code, simOutlet){
//         this.initParent(element, code, simOutlet);

//         var operandElem = $("<span></span>");
//         createCodeOutlet(operandElem, this.construct.operand, this);
//         this.exprElem.append(operandElem);

//         this.exprElem.append(htmlDecoratedOperator("--", "code-postfixOp"));
//     }
// });


export class SubscriptExpressionOutlet extends ExpressionOutlet<RuntimeSubscriptExpression> {

    public readonly operand: ExpressionOutlet;
    public readonly offset: ExpressionOutlet;

    public constructor(element: JQuery, construct: CompiledSubscriptExpression, parent?: ConstructOutlet) {
        super(element, construct, parent);

        this.element.addClass("code-subscript");

        this.operand = createExpressionOutlet($("<span></span>").appendTo(this.exprElem), this.construct.operand, this);
        this.exprElem.append(htmlDecoratedOperator("[", "code-postfixOp"));
        this.offset = createExpressionOutlet($("<span></span>").appendTo(this.exprElem), this.construct.offset, this);
        this.exprElem.append(htmlDecoratedOperator("]", "code-postfixOp"));
    }
}

// Lobster.Outlets.CPP.Dot = Outlets.CPP.Expression.extend({
//     _name: "Outlets.CPP.Dot",

//     init: function(element, code, simOutlet){
//         this.initParent(element, code, simOutlet);

//         var operandElem = $("<span></span>");
//         createCodeOutlet(operandElem, this.construct.operand, this);
//         this.exprElem.append(operandElem);

//         this.element.addClass("code-dot");
//         this.exprElem.append(htmlDecoratedOperator(".", "code-postfixOp"));

//         this.exprElem.append(htmlDecoratedName(this.construct.memberName, this.construct.type));
//     },

//     setEvalResult : function(value) {

//     }
// });

// Lobster.Outlets.CPP.Arrow = Outlets.CPP.Expression.extend({
//     _name: "Outlets.CPP.Arrow",

//     init: function(element, code, simOutlet){
//         this.initParent(element, code, simOutlet);

//         var operandElem = $("<span></span>");
//         createCodeOutlet(operandElem, this.construct.operand, this);
//         this.exprElem.append(operandElem);

//         this.element.addClass("code-dot");
//         this.exprElem.append(htmlDecoratedOperator("->", "code-postfixOp"));

//         this.exprElem.append(htmlDecoratedName(this.construct.memberName, this.construct.type));
//     },

//     setEvalResult : function(value) {

//     }
// });

export class ParenthesesOutlet extends ExpressionOutlet<RuntimeParentheses> {

    public readonly subexpression: ExpressionOutlet;

    public constructor(element: JQuery, construct: CompiledParentheses, parent?: ConstructOutlet) {
        super(element, construct, parent);

        this.exprElem.append("(");
        this.subexpression = createExpressionOutlet($("<span></span>").appendTo(this.exprElem), this.construct.subexpression, this);
        this.exprElem.append(")");
    }
}

export class IdentifierOutlet extends ExpressionOutlet<RuntimeObjectIdentifier | RuntimeFunctionIdentifier> {

    public constructor(element: JQuery, construct: CompiledObjectIdentifier | CompiledFunctionIdentifier, parent?: ConstructOutlet) {
        super(element, construct, parent);
        this.exprElem.addClass("code-name");

        this.exprElem.append(this.construct.name);
    }

    // setEvalResult : function(value) {

    // }
}

export class NumericLiteralOutlet extends ExpressionOutlet<RuntimeNumericLiteral> {

    public constructor(element: JQuery, construct: CompiledNumericLiteral, parent?: ConstructOutlet) {
        super(element, construct, parent);

        this.exprElem.addClass("code-literal");
        this.exprElem.append(this.construct.value.valueString());
    }
}

// Lobster.Outlets.CPP.ThisExpression = Outlets.CPP.Expression.extend({
//     _name: "Outlets.CPP.ThisExpression",

//     init: function(element, code, simOutlet){
//         this.initParent(element, code, simOutlet);
//         this.exprElem.addClass("code-this");
//         this.exprElem.append("this");
//     }
// });

export class TypeConversionOutlet extends ExpressionOutlet<RuntimeImplicitConversion> {
    
    public readonly from: ExpressionOutlet;

    public constructor(element: JQuery, construct: CompiledImplicitConversion, parent?: ConstructOutlet) {
        super(element, construct, parent);

        this.element.addClass("code-implicitConversion");
        this.from = createExpressionOutlet($("<span></span>").appendTo(this.exprElem), this.construct.from, this);
    }
}

export class LValueToRValueOutlet extends ExpressionOutlet<RuntimeImplicitConversion> {
    
    public readonly from: ExpressionOutlet;

    public constructor(element: JQuery, construct: CompiledImplicitConversion, parent?: ConstructOutlet) {
        super(element, construct, parent);
        this.element.addClass("code-lValueToRValue");
        this.from = createExpressionOutlet($("<span></span>").appendTo(this.exprElem), this.construct.from, this);
    }
}


export class ArrayToPointerOutlet extends ExpressionOutlet<RuntimeImplicitConversion> {
    
    public readonly from: ExpressionOutlet;

    public constructor(element: JQuery, construct: CompiledImplicitConversion, parent?: ConstructOutlet) {
        super(element, construct, parent);
        this.element.addClass("code-arrayToPointer");
        this.from = createExpressionOutlet($("<span></span>").appendTo(this.exprElem), this.construct.from, this);
    }
}

export class QualificationConversionOutlet extends ExpressionOutlet<RuntimeImplicitConversion> {
    
    public readonly from: ExpressionOutlet;

    public constructor(element: JQuery, construct: CompiledImplicitConversion, parent?: ConstructOutlet) {
        super(element, construct, parent);
        this.element.addClass("code-qualificationConversion");
        this.from = createExpressionOutlet($("<span></span>").appendTo(this.exprElem), this.construct.from, this);
    }
}

export function createExpressionOutlet(element: JQuery, construct: CompiledExpression, parent?: ConstructOutlet) {
    return construct.createDefaultOutlet(element, parent);
}

export function createInitializerOutlet(element: JQuery, construct: CompiledInitializer, parent?: ConstructOutlet) {
    return construct.createDefaultOutlet(element, parent);
}

export function createStatementOutlet(element: JQuery, construct: CompiledStatement, parent?: ConstructOutlet) {
    return construct.createDefaultOutlet(element, parent);
}

// var createCodeOutlet = function(element, code, parent){
//     assert(code);
//     assert(simOutlet);
//     var outletClass = DEFAULT_CODE_OUTLETS[code._class];
//     if (outletClass) {
//         return outletClass.instance(element, code, simOutlet);
//     }
//     else if(code.isA(Expressions.BinaryOperator)){
//         return Outlets.CPP.BinaryOperator.instance(element, code, simOutlet);
//     }
//     else if(code.isA(Conversions.ImplicitConversion)){
//         return Outlets.CPP.ImplicitConversion.instance(element, code, simOutlet);
//     }
//     else if(code.isA(Expressions.Expression)){
//         return Outlets.CPP.Expression.instance(element, code, simOutlet);
//     }
//     else{
//         return Outlets.CPP.Code.instance(element, code, simOutlet);
//     }

// };

// var DEFAULT_CODE_OUTLETS = {};
// DEFAULT_CODE_OUTLETS[Statements.Block] = Outlets.CPP.Block;
// DEFAULT_CODE_OUTLETS[Statements.FunctionBodyBlock] = Outlets.CPP.Block;
// DEFAULT_CODE_OUTLETS[Statements.OpaqueFunctionBodyBlock] = Outlets.CPP.OpaqueFunctionBodyBlock;
// DEFAULT_CODE_OUTLETS[Statements.DeclarationStatement] = Outlets.CPP.DeclarationStatement;
// DEFAULT_CODE_OUTLETS[Statements.ExpressionStatement] = Outlets.CPP.ExpressionStatement;
// DEFAULT_CODE_OUTLETS[Statements.Selection] = Outlets.CPP.Selection;
// DEFAULT_CODE_OUTLETS[Statements.While] = Outlets.CPP.While;
// DEFAULT_CODE_OUTLETS[Statements.DoWhile] = Outlets.CPP.DoWhile;
// DEFAULT_CODE_OUTLETS[Statements.For] = Outlets.CPP.For;
// DEFAULT_CODE_OUTLETS[Statements.Return] = Outlets.CPP.Return;
// DEFAULT_CODE_OUTLETS[Statements.Break] = Outlets.CPP.Break;
// DEFAULT_CODE_OUTLETS[Declarations.Declaration] = Outlets.CPP.Declaration;
// DEFAULT_CODE_OUTLETS[Declarations.Parameter] = Outlets.CPP.Parameter;
// //DEFAULT_CODE_OUTLETS[Initializer] = Outlets.CPP.Initializer;
// DEFAULT_CODE_OUTLETS[DefaultInitializer] = Outlets.CPP.DefaultInitializer;
// DEFAULT_CODE_OUTLETS[DefaultMemberInitializer] = Outlets.CPP.DefaultInitializer;
// DEFAULT_CODE_OUTLETS[MemberInitializer] = Outlets.CPP.DirectInitializer;
// DEFAULT_CODE_OUTLETS[DirectInitializer] = Outlets.CPP.DirectInitializer;
// DEFAULT_CODE_OUTLETS[CopyInitializer] = Outlets.CPP.CopyInitializer;
// DEFAULT_CODE_OUTLETS[ParameterInitializer] = Outlets.CPP.ParameterInitializer;
// DEFAULT_CODE_OUTLETS[ReturnInitializer] = Outlets.CPP.ReturnInitializer;
// DEFAULT_CODE_OUTLETS[InitializerList] = Outlets.CPP.InitializerList;
// DEFAULT_CODE_OUTLETS[Expressions.Expression] = Outlets.CPP.Expression;
// DEFAULT_CODE_OUTLETS[Expressions.BinaryOperator] = Outlets.CPP.BinaryOperator;
// //DEFAULT_CODE_OUTLETS[Expressions.BINARY_OPS["+"]] = Outlets.CPP.BinaryOperator;
// DEFAULT_CODE_OUTLETS[Expressions.Assignment] = Outlets.CPP.Assignment;
// DEFAULT_CODE_OUTLETS[Expressions.Ternary] = Outlets.CPP.Ternary;
// DEFAULT_CODE_OUTLETS[Expressions.Comma] = Outlets.CPP.Comma;
// DEFAULT_CODE_OUTLETS[Expressions.CompoundAssignment] = Outlets.CPP.CompoundAssignment;
// DEFAULT_CODE_OUTLETS[Expressions.FunctionCallExpression] = Outlets.CPP.FunctionCallExpression;
// DEFAULT_CODE_OUTLETS[Expressions.Subscript] = Outlets.CPP.Subscript;
// DEFAULT_CODE_OUTLETS[Expressions.Dot] = Outlets.CPP.Dot;
// DEFAULT_CODE_OUTLETS[Expressions.Arrow] = Outlets.CPP.Arrow;
// DEFAULT_CODE_OUTLETS[Expressions.Increment] = Outlets.CPP.Increment;
// DEFAULT_CODE_OUTLETS[Expressions.Decrement] = Outlets.CPP.Decrement;
// DEFAULT_CODE_OUTLETS[Expressions.NewExpression] = Outlets.CPP.NewExpression;
// DEFAULT_CODE_OUTLETS[Expressions.Delete] = Outlets.CPP.Delete;
// DEFAULT_CODE_OUTLETS[Expressions.DeleteArray] = Outlets.CPP.DeleteArray;
// DEFAULT_CODE_OUTLETS[Expressions.Construct] = Outlets.CPP.ConstructExpression;
// DEFAULT_CODE_OUTLETS[Expressions.LogicalNot] = Outlets.CPP.LogicalNot;
// DEFAULT_CODE_OUTLETS[Expressions.Prefix] = Outlets.CPP.Prefix;
// DEFAULT_CODE_OUTLETS[Expressions.Dereference] = Outlets.CPP.Dereference;
// DEFAULT_CODE_OUTLETS[Expressions.AddressOf] = Outlets.CPP.AddressOf;
// DEFAULT_CODE_OUTLETS[Expressions.UnaryPlus] = Outlets.CPP.UnaryPlus;
// DEFAULT_CODE_OUTLETS[Expressions.UnaryMinus] = Outlets.CPP.UnaryMinus;
// DEFAULT_CODE_OUTLETS[Expressions.Parentheses] = Outlets.CPP.Parentheses;
// DEFAULT_CODE_OUTLETS[Expressions.Identifier] = Outlets.CPP.Identifier;
// DEFAULT_CODE_OUTLETS[Expressions.Literal] = Outlets.CPP.Literal;
// DEFAULT_CODE_OUTLETS[Expressions.ThisExpression] = Outlets.CPP.ThisExpression;


// DEFAULT_CODE_OUTLETS[Conversions.ArrayToPointer] = Outlets.CPP.ArrayToPointer;
// DEFAULT_CODE_OUTLETS[Conversions.LValueToRValue] = Outlets.CPP.LValueToRValue;
// DEFAULT_CODE_OUTLETS[Conversions.QualificationConversion] = Outlets.CPP.QualificationConversion;