import React, { useState } from "react";
import { ButtonsRow } from "./button";
import Display from "./display";
import styles from "./calculator.module.css";
import { string } from "postcss-selector-parser";
import { isNumber } from "util";

const Calculator = props => {
  const buttonContents = [
    ["ce", "c", "del", "/"],
    [7, 8, 9, "*"],
    [4, 5, 6, "-"],
    [1, 2, 3, "+"],
    ["+/-", 0, ".", "="]
  ];
  const _precision = 16;
  const [operator, setOperator] = useState("");
  const [leftOperand, setLeftOperand] = useState(0);
  const [display, setDisplay] = useState("");
  const [prevInput, setPrevInput] = useState();

  function formatNumber(input) {
    const pN = Number(input).toPrecision(_precision);
    const result = Number.parseFloat(pN);
    return result;
  }

  function isNum(input) {
    return /^\d+$/.test(input);
  }

  const onHandleClick = input => {
    // if (input === "del") {
    //   if (isNum(prevInput) || prevInput === "del" ) {
    //     let previous = prevInput.toString();
    //     _display = formatNumber(previous.slice(0, -1));
    //   }
    // } else

    if (input === "ce") {
      setDisplay(0);
    }

    if (isNum(input)) {
      HandleNumbers(input);
    }

    if (isOperator(input)) {
      HandleOperator(input);
    }
  };
  function HandleNumbers(input) {
    let result;
    if (isOperator(prevInput)) {
      result = formatNumber(input);
    } else {
      result = formatNumber(display + input.toString());
    }

    setPrevInput(result);
    setDisplay(result);
  }

  function HandleOperator(input) {
    let result;
    if (isNum(prevInput) && (operator || input === "=")) {
      result = calculate(leftOperand, prevInput, operator);
    } else {
      result = display;
    }

    setDisplay(result);
    setLeftOperand(result);
    setPrevInput(input);
    setOperator(input);
  }

  function isOperator(input) {
    if (
      input === "+" ||
      input === "-" ||
      input === "*" ||
      input === "/" ||
      input === "="
    )
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
