import React from "react";
import styles from "./buttonsRow.module.css";
import Button from "./button";

const ButtonsRow = props => {
  const items = props.buttons.map(content => {
    return <Button key={content} onClick={props.onClick} content={content} />;
  });
  return <div className={styles.container}>{items}</div>;
};

export default ButtonsRow;
