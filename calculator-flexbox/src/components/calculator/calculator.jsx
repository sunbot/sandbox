import React, { useState } from "react";
import { ButtonsRow } from "./button";
import Display from "./display";
import styles from "./calculator.module.css";

const Calculator = props => {
  const buttonContents = [
    ["ce", "c", "del", "/"],
    [7, 8, 9, "*"],
    [4, 5, 6, "-"],
    [1, 2, 3, "+"],
    ["+/-", 0, ".", "="]
  ];
  const [operator, setOperator] = useState("");
  const [leftOperand, setLeftOperand] = useState(0);
  const [display, setDisplay] = useState("");
  const [prevInput, setPrevInput] = useState();

  const onHandleClick = input => {
    const isnum = /^\d+$/.test(input);
    let _display = display;
    let _leftOperand = leftOperand;
    let _operator = operator;

    if (isnum) {
      if (isOperator(prevInput)) {
        _display = Number(input.toString());
      } else {
        _display = Number(_display + input.toString());
      }
    } else if (isOperator(input)) {
      const isPrevInputNumber = /^\d+$/.test(prevInput);

      if (isPrevInputNumber && operator) {
        const result = calculate(leftOperand, prevInput, operator);
        _display = result;
        _leftOperand = result;
        _operator = input;
      } else {
        _operator = input;
        _leftOperand = Number(display);
      }
    }

    setPrevInput(isOperator(input) ? input : _display);
    setLeftOperand(_leftOperand);
    setDisplay(_display);
    setOperator(_operator);
  };

  function isOperator(input) {
    if (input === "+" || input === "-" || input === "*" || input === "/")
      return true;
  }

  function calculate(left, right, operator) {
    const leftNum = Number(left);
    const rightNum = Number(right);
    if (operator === "+") {
      const result = leftNum + rightNum;
      console.log(`${left}${operator}${right}=${result}`);
      console.log(result);
      return result;
    }
    if (operator === "-") {
      return leftNum - rightNum;
    }
    if (operator === "*") {
      return leftNum * rightNum;
    }
    if (operator === "/") {
      return leftNum / rightNum;
    }
  }

  let buttonRows = buttonContents.map((row, index) => {
    return <ButtonsRow key={index} buttons={row} onClick={onHandleClick} />;
  });
  console.log("display:" + display);
  return (
    <div className={styles.container}>
      <Display content={display} />
      {buttonRows}
    </div>
  );
};

export default Calculator;
