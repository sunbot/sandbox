import React from "react";
// import "flexbox";
import styles from "./calculator.module.css";

const Calculator = props => {
  let buttons = [
    "+/-",
    0,
    ".",
    "=",
    1,
    2,
    3,
    "+",
    4,
    5,
    6,
    "-",
    7,
    8,
    9,
    "*",
    "/",
    "x",
    "c",
    "ce"
  ];

  let calcButtonRow = <div className={styles.buttonPanel} />;

  return (
    <div className={styles.container}>
      {buttons.map(key => (
        <div className={styles.button}>{key}</div>
      ))}
    </div>
  );
};

export default Calculator;
