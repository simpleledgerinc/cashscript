/*   IR.test.ts
 *
 * - This file is used to test the IR
 */

import { assert } from 'chai';
import * as path from 'path';
import * as fs from 'fs';
import SymbolTableTraversal from '../../src/semantic/SymbolTableTraversal';
import { Node, Ast } from '../../src/ast/AST';
import TypeCheckTraversal from '../../src/semantic/TypeCheckTraversal';
import { parseCode } from '../../src/sdk';
import GenerateIrTraversal from '../../src/ir/GenerateIrTraversal';
import { GlobalFunction, TimeOp } from '../../src/ast/Globals';
import { BinaryOperator } from '../../src/ast/Operator';
import {
  Call,
  Get,
  Op,
  PushInt,
  PushString,
  If,
  Replace,
  Drop,
  EndIf,
  Else,
} from '../../src/ir/IR';

interface TestSetup {
  ast: Node,
  traversal: GenerateIrTraversal,
}

function setup(input: string): TestSetup {
  let ast = parseCode(input);
  ast = ast.accept(new SymbolTableTraversal()) as Ast;
  ast = ast.accept(new TypeCheckTraversal()) as Ast;
  const traversal = new GenerateIrTraversal();

  return { ast, traversal };
}

describe('IR', () => {
  it('should compile P2PKH contract', () => {
    const code = fs.readFileSync(path.join(__dirname, 'fixture', 'p2pkh.cash'), { encoding: 'utf-8' });
    const { ast, traversal } = setup(code);
    ast.accept(traversal);
    const expectedIr = [
      new Get(1), new Call(GlobalFunction.SHA256),
      new Get(1), new Call(BinaryOperator.EQ),
      new Call(GlobalFunction.REQUIRE),
      new Get(2), new Get(2), new Call(GlobalFunction.CHECKSIG),
      new Call(GlobalFunction.REQUIRE),
    ];
    assert.deepEqual(
      traversal.output.map(o => o.toString()),
      expectedIr.map(o => o.toString()),
    );
    assert.deepEqual(traversal.stack, ['pkh', 'pk', 's']);
  });

  it('should compile simple_variables contract (includes reassignment)', () => {
    const code = fs.readFileSync(path.join(__dirname, 'fixture', 'simple_variables.cash'), { encoding: 'utf-8' });
    const { ast, traversal } = setup(code);
    ast.accept(traversal);
    const expectedIr: Op[] = [
      new PushInt(10), new PushInt(4), new Call(BinaryOperator.MINUS),
      new PushInt(20), new Get(1), new PushInt(2),
      new Call(BinaryOperator.MOD), new Call(BinaryOperator.PLUS),
      new Get(0), new Get(3), new Call(BinaryOperator.GT), new Call(GlobalFunction.REQUIRE),
      new PushString('Hello World'),
      new Get(0), new Get(5), new Call(BinaryOperator.PLUS),
      new Get(6), new Call(GlobalFunction.RIPEMD160),
      new Get(1), new Call(GlobalFunction.RIPEMD160),
      new Call(BinaryOperator.EQ), new Call(GlobalFunction.REQUIRE),
      new Get(7), new Get(7), new Call(GlobalFunction.CHECKSIG),
      new Call(GlobalFunction.REQUIRE),
    ];
    assert.deepEqual(
      traversal.output.map(o => o.toString()),
      expectedIr.map(o => o.toString()),
    );
    assert.deepEqual(traversal.stack, ['hw', 'hw', 'myOtherVariable', 'myVariable', 'x', 'y', 'pk', 's']);
  });

  it('should compile if_statements contract (includes scoped variables / reassignment)', () => {
    const code = fs.readFileSync(path.join(__dirname, 'fixture', 'if_statement.cash'), { encoding: 'utf-8' });
    const { ast, traversal } = setup(code);
    ast.accept(traversal);
    const expectedIr: Op[] = [
      new Get(2), new Get(4), new Call(BinaryOperator.PLUS),
      new Get(0), new Get(4), new Call(BinaryOperator.MINUS),
      new Get(0), new Get(3), new PushInt(2), new Call(BinaryOperator.MINUS),
      new Call(BinaryOperator.EQ), new If(),
      new Get(0), new Get(6), new Call(BinaryOperator.PLUS),
      new Get(5), new Get(1), new Call(BinaryOperator.PLUS), new Replace(2),
      new Get(0), new Get(2), new Call(BinaryOperator.GT), new Call(GlobalFunction.REQUIRE),
      new Drop(), new Else(),
      new Get(0), new Get(5), new Call(BinaryOperator.EQ), new Call(GlobalFunction.REQUIRE),
      new EndIf(),
      new Get(0), new Get(5), new Call(BinaryOperator.PLUS),
      new Get(0), new Get(5), new Call(BinaryOperator.EQ), new Call(GlobalFunction.REQUIRE),
    ];
    assert.deepEqual(
      traversal.output.map(o => o.toString()),
      expectedIr.map(o => o.toString()),
    );
    assert.deepEqual(traversal.stack, ['d', 'd', 'd', 'x', 'y', 'a', 'b']);
  });

  it('should compile transfer_with_timeout (multi-function contract)', () => {
    const code = fs.readFileSync(path.join(__dirname, 'fixture', 'transfer_with_timeout.cash'), { encoding: 'utf-8' });
    const { ast, traversal } = setup(code);
    ast.accept(traversal);
    const expectedIr: Op[] = [
      new Get(3), new PushInt(0), new Call(BinaryOperator.EQ), new If(),
      new Get(4), new Get(2), new Call(GlobalFunction.CHECKSIG), new Call(GlobalFunction.REQUIRE),
      new Else(), new Get(3), new PushInt(1), new Call(BinaryOperator.EQ), new If(),
      new Get(4), new Get(1), new Call(GlobalFunction.CHECKSIG), new Call(GlobalFunction.REQUIRE),
      new Get(2), new Call(TimeOp.CHECK_LOCKTIME),
      new EndIf(), new EndIf(),
    ];
    assert.deepEqual(
      traversal.output.map(o => o.toString()),
      expectedIr.map(o => o.toString()),
    );
    assert.deepEqual(traversal.stack, ['sender', 'recipient', 'timeout', '$$', 'senderSig']);
  });

  it('should compile multifunction_if_statements.cash (multi-function, scoping, reassignment)', () => {
    const code = fs.readFileSync(path.join(__dirname, 'fixture', 'multifunction_if_statements.cash'), { encoding: 'utf-8' });
    const { ast, traversal } = setup(code);
    ast.accept(traversal);
    const expectedIr: Op[] = [
      new Get(2), new PushInt(0), new Call(BinaryOperator.EQ), new If(),
      new Get(3), new Get(5), new Call(BinaryOperator.PLUS),
      new Get(0), new Get(5), new Call(BinaryOperator.MINUS),
      new Get(0), new Get(3), new Call(BinaryOperator.EQ), new If(),
      new Get(0), new Get(7), new Call(BinaryOperator.PLUS),
      new Get(6), new Get(1), new Call(BinaryOperator.PLUS), new Replace(2),
      new Get(0), new Get(2), new Call(BinaryOperator.GT), new Call(GlobalFunction.REQUIRE),
      new Drop(), new Else(),
      new Get(5), new Replace(1),
      new EndIf(),
      new Get(0), new Get(6), new Call(BinaryOperator.PLUS),
      new Get(0), new Get(5), new Call(BinaryOperator.EQ), new Call(GlobalFunction.REQUIRE),
      new Else(), new Get(2), new PushInt(1), new Call(BinaryOperator.EQ), new If(),
      new Get(3),
      new Get(0), new PushInt(2), new Call(BinaryOperator.PLUS),
      new Get(0), new Get(3), new Call(BinaryOperator.EQ), new If(),
      new Get(0), new Get(6), new Call(BinaryOperator.PLUS),
      new Get(0), new Get(2), new Call(BinaryOperator.PLUS), new Replace(2),
      new Get(0), new Get(2), new Call(BinaryOperator.GT), new Call(GlobalFunction.REQUIRE),
      new Drop(), new EndIf(),
      new Get(5),
      new Get(0), new Get(5), new Call(BinaryOperator.EQ), new Call(GlobalFunction.REQUIRE),
      new EndIf(), new EndIf(),
    ];
    assert.deepEqual(
      traversal.output.map(o => o.toString()),
      expectedIr.map(o => o.toString()),
    );
    assert.deepEqual(traversal.stack, ['d', 'd', 'd', 'x', 'y', '$$', 'b']);
  });

  it('should compile multisig', () => {
    const code = fs.readFileSync(path.join(__dirname, 'fixture', '2_of_3_multisig.cash'), { encoding: 'utf-8' });
    const { ast, traversal } = setup(code);
    ast.accept(traversal);
    const expectedIr: Op[] = [
      new Get(3), new Get(5), new PushInt(2),
      new Get(3), new Get(5), new Get(7), new PushInt(3),
      new Call(GlobalFunction.CHECKMULTISIG), new Call(GlobalFunction.REQUIRE),
    ];
    assert.deepEqual(
      traversal.output.map(o => o.toString()),
      expectedIr.map(o => o.toString()),
    );
    assert.deepEqual(traversal.stack, ['pk1', 'pk2', 'pk3', 's1', 's2']);
  });

  it('should compile splice/tuple/size', () => {
    // TODO
  });
});