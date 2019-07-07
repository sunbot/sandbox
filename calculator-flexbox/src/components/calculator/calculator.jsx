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
    if (input === "del") {
      deleteRecent();
    }

    if (input === "c") {
      clearAll();
    }

    if (input === "ce") {
      clearRecent();
    }

    if (isNum(input)) {
      HandleNumbers(input);
    }

    if (isOperator(input)) {
      HandleOperator(input);
    }
  };

  function clearRecent() {
    if (prevInput === "=") {
      clearAll();
    }

    if (isOperator(prevInput) || isNumber(prevInput)) {
      HandleNumbers(0);
    }
  }

  function deleteRecent() {
    // if (isNum(prevInput)) {
    //   let _display = display.toString();
    //   const result = formatNumber(_display.slice(0, -1));
    //   if (prevInput === 0) HandleNumbers(result);
    //   else {
    //     setPrevInput(result);
    //     setDisplay(result);
    //   }
    // }
  }

  function clearAll() {
    setOperator("");
    setLeftOperand(0);
    setPrevInput();
    setDisplay("");
  }

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
    let result = display;
    // if '=' evaluate now
    if (isNum(prevInput) && (operator || input === "=")) {
      result = calculate(leftOperand, prevInput, operator);
    }

    setLeftOperand(result);
    setPrevInput(input);
    setOperator(input);
    setDisplay(result);
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
      return leftNum + rightNum;
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
