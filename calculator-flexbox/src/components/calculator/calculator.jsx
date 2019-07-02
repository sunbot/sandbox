import React, { useState } from "react";
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

  const [result, setResult] = useState();

  const onHandleClick = input => {
    if (result) setResult(result.toString() + input);
    else {
      setResult(input);
    }
  };

  let buttonRows = buttonContents.map((row, index) => {
    return <ButtonsRow key={index} buttons={row} onClick={onHandleClick} />;
  });
  return (
    <div className={styles.container}>
      <Display content={result} />
      {buttonRows}
    </div>
  );
};

export default Calculator;
