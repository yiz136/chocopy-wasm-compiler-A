import {parser} from "lezer-python";
import { TreeCursor} from "lezer-tree";
import { Program, Expr, Stmt, UniOp, BinOp, Parameter, Type, FunDef, VarInit, Class, Literal } from "./ast";
import { NUM, BOOL, NONE, CLASS } from "./utils";
import { stringifyTree } from "./treeprinter";

export function traverseLiteral(c : TreeCursor, s : string) : Literal {
  switch(c.type.name) {
    case "Number":
      return {
        tag: "num",
        value: Number(s.substring(c.from, c.to))
      }
    case "Boolean":
      return {
        tag: "bool",
        value: s.substring(c.from, c.to) === "True"
      }
    case "None":
      return {
        tag: "none"
      }
    default:
      throw new Error("Not literal")
  }
}

export function traverseExpr(c : TreeCursor, s : string) : Expr<null> {
  switch(c.type.name) {
    case "Number":
    case "Boolean":
    case "None":
      return { 
        tag: "literal", 
        value: traverseLiteral(c, s)
      }      
    case "VariableName":
      return {
        tag: "id",
        name: s.substring(c.from, c.to)
      }
    case "CallExpression":
      c.firstChild();
      // set method call len()
      if (s.substring(c.from, c.to) === "len") {
        c.nextSibling(); // Arglist
        let args = traverseArguments(c, s);
        c.parent();
        return { tag: "method-call", obj: args[0], method: "size", arguments: []};
      }
      const callExpr = traverseExpr(c, s);
      // set() initialization
      if (callExpr.tag === "id" && callExpr.name === "set") {
        c.parent();
        return { tag: "set_expr", contents: []};
      }
      c.nextSibling(); // go to arglist
      let args = traverseArguments(c, s);
      c.parent(); // pop CallExpression

      if (callExpr.tag === "lookup") {
        return {
          tag: "method-call",
          obj: callExpr.obj,
          method: callExpr.field,
          arguments: args
        }
      } else if (callExpr.tag === "id") {
        const callName = callExpr.name;
        var expr : Expr<null>;
        if (callName === "print" || callName === "abs") {
          expr = {
            tag: "builtin1",
            name: callName,
            arg: args[0]
          };
        } else if (callName === "max" || callName === "min" || callName === "pow") {
          expr = {
            tag: "builtin2",
            name: callName,
            left: args[0],
            right: args[1]
          }
        }
        else {
          expr = { tag: "call", name: callName, arguments: args};
        }
        return expr;  
      } else {
        throw new Error("Unknown target while parsing assignment");
      }

    case "BinaryExpression":
      c.firstChild(); // go to lhs 
      const lhsExpr = traverseExpr(c, s);
      c.nextSibling(); // go to op
      var opStr = s.substring(c.from, c.to);
      var op;
      switch(opStr) {
        case "+":
          op = BinOp.Plus;
          break;
        case "-":
          op = BinOp.Minus;
          break;
        case "*":
          op = BinOp.Mul;
          break;
        case "//":
          op = BinOp.IDiv;
          break;
        case "%":
          op = BinOp.Mod;
          break
        case "==":
          op = BinOp.Eq;
          break;
        case "!=":
          op = BinOp.Neq;
          break;
        case "<=":
          op = BinOp.Lte;
          break;
        case ">=":
          op = BinOp.Gte;
          break;
        case "<":
          op = BinOp.Lt;
          break;
        case ">":
          op = BinOp.Gt;
          break;
        case "is":
          op = BinOp.Is;
          break; 
        case "and":
          op = BinOp.And;
          break;
        case "or":
          op = BinOp.Or;
          break;
        case "in": // set - has method
          c.nextSibling();
          const obj = traverseExpr(c, s);
          c.parent();
          return { tag: "method-call", obj: obj, method: "has", arguments: [lhsExpr] };
        default:
          throw new Error("Could not parse op at " + c.from + " " + c.to + ": " + s.substring(c.from, c.to))
      }
      c.nextSibling(); // go to rhs
      const rhsExpr = traverseExpr(c, s);
      c.parent();
      return {
        tag: "binop",
        op: op,
        left: lhsExpr,
        right: rhsExpr
      }
    case "ParenthesizedExpression":
      c.firstChild(); // Focus on (
      c.nextSibling(); // Focus on inside
      var expr = traverseExpr(c, s);
      c.parent();
      return expr;
    case "UnaryExpression":
      c.firstChild(); // Focus on op
      var opStr = s.substring(c.from, c.to);
      var op;
      switch(opStr) {
        case "-":
          op = UniOp.Neg;
          break;
        case "not":
          op = UniOp.Not;
          break;
        default:
          throw new Error("Could not parse op at " + c.from + " " + c.to + ": " + s.substring(c.from, c.to))
      }
      c.nextSibling(); // go to expr
      var expr = traverseExpr(c, s);
      c.parent();
      return {
        tag: "uniop",
        op: op,
        expr: expr
      }
    case "MemberExpression":
      c.firstChild(); // Focus on object
      var objExpr = traverseExpr(c, s);
      c.nextSibling(); // Focus on . or [
      // bracket???
      if (s.substring(c.from, c.to) == "[") {
        // Start with :
        c.nextSibling(); // Focus on start index or : or index/key
        if (s.substring(c.from, c.to) == ":") {
          c.nextSibling(); // Focus on end index or ]
          if (s.substring(c.from, c.to) == "]") {
            c.parent();
            return { tag: "slice", obj: objExpr };
          }
          var endIndex = traverseExpr(c, s);
          c.parent();
          return { tag: "slice", obj: objExpr, index_e: endIndex };
        }

        // Start index or index/key
        var startIndex = traverseExpr(c, s);
        c.nextSibling(); // Focus on : or ]
        if (s.substring(c.from, c.to) == "]") {
          c.parent();
          return { tag: "index", obj: objExpr, index: startIndex }; // dict: key
        }

        // Start index and :
        c.nextSibling(); // Focus on end index or ]
        if (s.substring(c.from, c.to) == "]") {
          c.parent();
          return { tag: "slice", obj: objExpr, index_s: startIndex };
        }
        var endIndex = traverseExpr(c, s);
        c.parent();
        return {
          tag: "slice",
          obj: objExpr,
          index_s: startIndex,
          index_e: endIndex,
        };
      } else {
      c.nextSibling(); // Focus on property
      var propName = s.substring(c.from, c.to);
      c.parent();
      return {
        tag: "lookup",
        obj: objExpr,
        field: propName
      }
    }
    case "self":
      return {
        tag: "id",
        name: "self"
      };
    
    case "SetExpression": // set() add/remove/clear/update
      let elements: Array<Expr<any>> = [];
      c.firstChild(); // Focus on "{"
      while (c.nextSibling()) {
        let key = traverseExpr(c, s);
        elements.push(key);
        c.nextSibling(); // Focus on } or ,
      }
      c.parent(); // Pop to SetExpression
      return { tag: "set_expr", contents: elements };
    
    case "DictionaryExpression":
      // entries: Array<[Expr<A>, Expr<A>]>
      let keyValuePairs: Array<[Expr<any>, Expr<any>]> = [];
      c.firstChild(); // Focus on "{"
      while (c.nextSibling()) {
        if (s.substring(c.from, c.to) === "}") {
          // check for empty dict
          break;
        }
        let key = traverseExpr(c, s);
        c.nextSibling(); // Focus on :
        c.nextSibling(); // Focus on Value
        let value = traverseExpr(c, s);
        keyValuePairs.push([key, value]);
        c.nextSibling(); // Focus on } or ,
      }
      c.parent(); // Pop to DictionaryExpression
      return { tag: "dict_expr", entries: keyValuePairs };
    
    case "TupleExpression":
      let tupleExpr: Expr<any>[] = [];
      c.firstChild(); // Open parenthesis "("
      c.nextSibling();
      while (c.name !== ")") {
        tupleExpr.push(traverseExpr(c, s));
        c.nextSibling(); // comma ","
        c.nextSibling(); // next expression or closing parenthesis ")"
      }
      c.parent();
      return { tag: "tuple_expr", contents: tupleExpr };

    default:
      throw new Error("Could not parse expr at " + c.from + " " + c.to + ": " + s.substring(c.from, c.to));
  }
}

export function traverseArguments(c : TreeCursor, s : string) : Array<Expr<null>> {
  c.firstChild();  // Focuses on open paren
  const args = [];
  c.nextSibling();
  while(c.type.name !== ")") {
    let expr = traverseExpr(c, s);
    args.push(expr);
    c.nextSibling(); // Focuses on either "," or ")"
    c.nextSibling(); // Focuses on a VariableName
  } 
  c.parent();       // Pop to ArgList
  return args;
}

export function traverseStmt(c : TreeCursor, s : string) : Stmt<null> {
  switch(c.node.type.name) {
    case "ReturnStatement":
      c.firstChild();  // Focus return keyword
      
      var value : Expr<null>;
      if (c.nextSibling()) // Focus expression
        value = traverseExpr(c, s);
      else
        value = { tag: "literal", value: { tag: "none" } };
      c.parent();
      return { tag: "return", value };
    case "AssignStatement":
      c.firstChild(); // go to name
      const target = traverseExpr(c, s);
      c.nextSibling(); // go to equals
      if (c.type.name === "TypeDef") { // Set Initialization -> go to AssignOp (=)
          c.nextSibling(); // go to equal
      }
      c.nextSibling(); // go to value
      var value = traverseExpr(c, s);
      c.parent();

      if (target.tag === "lookup") {
        return {
          tag: "field-assign",
          obj: target.obj,
          field: target.field,
          value: value
        }
      } else if (target.tag === "id") {
        return {
          tag: "assign",
          name: target.name,
          value: value
        }  
      } else if (target.tag === "index") {
        return {
          tag: "index-assign",
          obj: target.obj,
          index: target.index,
          value: value,
        }
      } else {
        throw new Error("Unknown target while parsing assignment");
      }
    case "ExpressionStatement":
      c.firstChild();
      const expr = traverseExpr(c, s);
      c.parent(); // pop going into stmt
      return { tag: "expr", expr: expr }
    // case "FunctionDefinition":
    //   c.firstChild();  // Focus on def
    //   c.nextSibling(); // Focus on name of function
    //   var name = s.substring(c.from, c.to);
    //   c.nextSibling(); // Focus on ParamList
    //   var parameters = traverseParameters(c, s)
    //   c.nextSibling(); // Focus on Body or TypeDef
    //   let ret : Type = NONE;
    //   if(c.type.name === "TypeDef") {
    //     c.firstChild();
    //     ret = traverseType(c, s);
    //     c.parent();
    //   }
    //   c.firstChild();  // Focus on :
    //   var body = [];
    //   while(c.nextSibling()) {
    //     body.push(traverseStmt(c, s));
    //   }
      // console.log("Before pop to body: ", c.type.name);
    //   c.parent();      // Pop to Body
      // console.log("Before pop to def: ", c.type.name);
    //   c.parent();      // Pop to FunctionDefinition
    //   return {
    //     tag: "fun",
    //     name, parameters, body, ret
    //   }
    case "IfStatement":
      c.firstChild(); // Focus on if
      c.nextSibling(); // Focus on cond
      var cond = traverseExpr(c, s);
      // console.log("Cond:", cond);
      c.nextSibling(); // Focus on : thn
      c.firstChild(); // Focus on :
      var thn = [];
      var els = [];
      while(c.nextSibling()) {  // Focus on thn stmts
        thn.push(traverseStmt(c,s));
      }
      // console.log("Thn:", thn);
      c.parent();
      
      if (c.nextSibling()) {  // Focus on else
        c.nextSibling(); // Focus on : els
        c.firstChild(); // Focus on :
        while(c.nextSibling()) { // Focus on els stmts
          els.push(traverseStmt(c, s));
        }
        c.parent();  
      }
      c.parent();
      return {
        tag: "if",
        cond: cond,
        thn: thn,
        els: els
      }
    case "WhileStatement":
      c.firstChild(); // Focus on while
      c.nextSibling(); // Focus on condition
      var cond = traverseExpr(c, s);
      c.nextSibling(); // Focus on body

      var body = [];
      c.firstChild(); // Focus on :
      while(c.nextSibling()) {
        body.push(traverseStmt(c, s));
      }
      c.parent(); 
      c.parent();
      return {
        tag: "while",
        cond,
        body
      }
    case "PassStatement":
      return { tag: "pass" }
    default:
      throw new Error("Could not parse stmt at " + c.node.from + " " + c.node.to + ": " + s.substring(c.from, c.to));
  }
}

export function traverseType(c : TreeCursor, s : string) : Type {
  // For now, always a VariableName
  let name = s.substring(c.from, c.to);
  switch(name) {
    case "int": return NUM;
    case "bool": return BOOL;
    default: return CLASS(name);
  }
}

export function traverseParameters(c : TreeCursor, s : string) : Array<Parameter<null>> {
  c.firstChild();  // Focuses on open paren
  const parameters = [];
  c.nextSibling(); // Focuses on a VariableName
  while(c.type.name !== ")") {
    let name = s.substring(c.from, c.to);
    c.nextSibling(); // Focuses on "TypeDef", hopefully, or "," if mistake
    let nextTagName = c.type.name; // NOTE(joe): a bit of a hack so the next line doesn't if-split
    if(nextTagName !== "TypeDef") { throw new Error("Missed type annotation for parameter " + name)};
    c.firstChild();  // Enter TypeDef
    c.nextSibling(); // Focuses on type itself
    let typ = traverseType(c, s);
    c.parent();
    c.nextSibling(); // Move on to comma or ")"
    parameters.push({name, type: typ});
    c.nextSibling(); // Focuses on a VariableName
  }
  c.parent();       // Pop to ParamList
  return parameters;
}

export function traverseVarInit(c : TreeCursor, s : string) : VarInit<null> {
  c.firstChild(); // go to name
  var name = s.substring(c.from, c.to);
  c.nextSibling(); // go to : type

  if(c.type.name !== "TypeDef") {
    c.parent();
    throw Error("invalid variable init");
  }
  c.firstChild(); // go to :
  c.nextSibling(); // go to VariableName
  // Set Initialization
  if (s.substring(c.from, c.to) === "set") {
    c.parent();
    c.parent();
    return { name, type: { tag: "set", content_type: {tag: "number"} }, value: { tag: "set"}};
  }
  // Dict Initialization
  else if (s.substring(c.from, c.to) === "dict") {
    c.parent();
    c.nextSibling(); // AssignOp
    c.nextSibling(); // CallExpression
    c.firstChild(); // VariableName
    c.nextSibling(); // ArgList
    c.firstChild(); // (
    c.nextSibling(); // ArrayExpression
    c.firstChild(); // [
    c.nextSibling(); // VariableName
    var key_type : Type;
    var value_type : Type;
    if (s.substring(c.from, c.to) === "int") { key_type = {tag: "number"}; } 
    else if (s.substring(c.from, c.to) === "bool") key_type = {tag: "bool"};
    else key_type = {tag: "none"};
    c.nextSibling(); // ,
    c.nextSibling(); // VariableName
    if (s.substring(c.from, c.to) === "int") { value_type = {tag: "number"}; } 
    else if (s.substring(c.from, c.to) === "bool") value_type = {tag: "bool"};
    else value_type = {tag: "none"};
    c.parent();
    c.parent();
    c.parent();
    c.parent();
    return { name, type: { tag: "dict", key: key_type, value: value_type }, value: { tag: "dict", key_typ: key_type, val_typ: value_type} };
  }
  const type = traverseType(c, s);
  c.parent();
  
  c.nextSibling(); // go to =
  c.nextSibling(); // go to value
  var value = traverseLiteral(c, s);
  c.parent();

  return { name, type, value }
}

export function traverseFunDef(c : TreeCursor, s : string) : FunDef<null> {
  c.firstChild();  // Focus on def
  c.nextSibling(); // Focus on name of function
  var name = s.substring(c.from, c.to);
  c.nextSibling(); // Focus on ParamList
  var parameters = traverseParameters(c, s)
  c.nextSibling(); // Focus on Body or TypeDef
  let ret : Type = NONE;
  if(c.type.name === "TypeDef") {
    c.firstChild();
    ret = traverseType(c, s);
    c.parent();
    c.nextSibling();
  }
  c.firstChild();  // Focus on :
  var inits = [];
  var body = [];
  
  var hasChild = c.nextSibling();

  while(hasChild) {
    if (isVarInit(c, s)) {
      inits.push(traverseVarInit(c, s));
    } else {
      break;
    }
    hasChild = c.nextSibling();
  }

  while(hasChild) {
    body.push(traverseStmt(c, s));
    hasChild = c.nextSibling();
  } 
  
  // console.log("Before pop to body: ", c.type.name);
  c.parent();      // Pop to Body
  // console.log("Before pop to def: ", c.type.name);
  c.parent();      // Pop to FunctionDefinition
  return { name, parameters, ret, inits, body }
}

export function traverseClass(c : TreeCursor, s : string) : Class<null> {
  const fields : Array<VarInit<null>> = [];
  const methods : Array<FunDef<null>> = [];
  c.firstChild();
  c.nextSibling(); // Focus on class name
  const className = s.substring(c.from, c.to);
  c.nextSibling(); // Focus on arglist/superclass
  c.nextSibling(); // Focus on body
  c.firstChild();  // Focus colon
  while(c.nextSibling()) { // Focuses first field
    if (isVarInit(c, s)) {
      fields.push(traverseVarInit(c, s));
    } else if (isFunDef(c, s)) {
      methods.push(traverseFunDef(c, s));
    } else {
      throw new Error(`Could not parse the body of class: ${className}` );
    }
  } 
  c.parent();
  c.parent();

  if (!methods.find(method => method.name === "__init__")) {
    methods.push({ name: "__init__", parameters: [{ name: "self", type: CLASS(className) }], ret: NONE, inits: [], body: [] });
  }
  return {
    name: className,
    fields,
    methods
  };
}

export function traverseDefs(c : TreeCursor, s : string) : [Array<VarInit<null>>, Array<FunDef<null>>, Array<Class<null>>] {
  const inits : Array<VarInit<null>> = [];
  const funs : Array<FunDef<null>> = [];
  const classes : Array<Class<null>> = [];

  while(true) {
    if (isVarInit(c, s)) {
      inits.push(traverseVarInit(c, s));
    } else if (isFunDef(c, s)) {
      funs.push(traverseFunDef(c, s));
    } else if (isClassDef(c, s)) {
      classes.push(traverseClass(c, s));
    } else {
      return [inits, funs, classes];
    }
    c.nextSibling();
  }

}

export function isVarInit(c : TreeCursor, s : string) : Boolean {
  if (c.type.name === "AssignStatement") {
    c.firstChild(); // Focus on lhs
    c.nextSibling(); // go to : type

    const isVar = c.type.name as any === "TypeDef";
    // if (isVar === true){
    //   c.firstChild();
    //   c.nextSibling();
    //   if (s.substring(c.from, c.to) === "set") {
    //     c.parent();
    //     c.parent();
    //     return false;}
    //   c.parent();
    // }
    c.parent();
    return isVar;  
  } else {
    return false;
  }
}

export function isFunDef(c : TreeCursor, s : string) : Boolean {
  return c.type.name === "FunctionDefinition";
}

export function isClassDef(c : TreeCursor, s : string) : Boolean {
  return c.type.name === "ClassDefinition";
}

export function traverse(c : TreeCursor, s : string) : Program<null> {
  switch(c.node.type.name) {
    case "Script":
      const inits : Array<VarInit<null>> = [];
      const funs : Array<FunDef<null>> = [];
      const classes : Array<Class<null>> = [];
      const stmts : Array<Stmt<null>> = [];
      var hasChild = c.firstChild();

      while(hasChild) {
        if (isVarInit(c, s)) {
          inits.push(traverseVarInit(c, s));
        } else if (isFunDef(c, s)) {
          funs.push(traverseFunDef(c, s));
        } else if (isClassDef(c, s)) {
          classes.push(traverseClass(c, s));
        } else {
          break;
        }
        hasChild = c.nextSibling();
      }

      while(hasChild) {
        stmts.push(traverseStmt(c, s));
        hasChild = c.nextSibling();
      } 
      c.parent();
      return { funs, inits, classes, stmts };
    default:
      throw new Error("Could not parse program at " + c.node.from + " " + c.node.to);
  }
}

export function parse(source : string) : Program<null> {
  const t = parser.parse(source);
  const str = stringifyTree(t.cursor(), source, 0);
  return traverse(t.cursor(), source);
}
