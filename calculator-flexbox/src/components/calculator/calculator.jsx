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
  const [current, setCurrent] = useState("");
  const [operator, setOperator] = useState("+");
  const [leftOperand, setLeftOperand] = useState(0);
  const [display, setDisplay] = useState("");

  const onHandleClick = input => {
    var isnum = /^\d+$/.test(input);
    console.log("current " + current);

    // if (input === "+/-") {
    //   setCurrent(-current);
    //   setDisplay(-current);
    // } else
    if (!isnum) {
      const result = calculate(leftOperand, current, operator);
      setOperator(input);
      setCurrent("");
      setLeftOperand(result);
      setDisplay(result);
    } else {
      const result =
        !display && input === 0 ? "" : current.toString() + input.toString();
      setCurrent(result);
      setDisplay(result);
    }
  };

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
