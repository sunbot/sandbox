import React from "react";
import { ButtonsRow } from "./button";
import Display from "./display";
import styles from "./calculator.module.css";

const Calculator = props => {
  let buttonContents = [
    ["ce", "c", "del", "/"],
    [7, 8, 9, "*"],
    [4, 5, 6, "-"],
    [1, 2, 3, "+"],
    ["+/-", 0, ".", "="]
  ];

  let buttonRows = buttonContents.map(row => {
    return <ButtonsRow buttons={row} />;
  });

  return (
    <div className={styles.container}>
      <Display />
      {buttonRows}
    </div>
  );
};

export default Calculator;
